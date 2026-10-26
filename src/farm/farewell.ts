import {farmWallet} from './wallet'
import {conflictBattleRules} from './conflict-rules'
import {farewellValue,type FarewellLot,type FarewellLease} from './farewell-value'
import {FARM_CLOSE_AT,FARM_FAREWELL_ID,FARM_FAREWELL_BONUS,farmClosed} from './lifecycle'

type FarewellBattle={attacker_id:number;defender_id:number;starts_at:number;resolves_at:number;attack_tools:number;defense_tools:number;bond:number;status:string}
const farewellLive="EXISTS(SELECT 1 FROM users WHERE id=?1 AND id>0 AND disabled=0 AND kind='user') AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?1)"
export async function settleFarmFarewellUser(db:D1Database,uid:number,t:number,prices:Record<string,number>){
 const row=await farmWallet(db,uid,FARM_CLOSE_AT)
 await db.prepare(`INSERT OR IGNORE INTO coin52_wallets(user_id,updated_at) SELECT ?1,?2 WHERE ${farewellLive}`).bind(uid,t).run()
 const queries=await db.batch<Record<string,unknown>>([
  db.prepare('SELECT balance,revision FROM coin52_wallets WHERE user_id=?').bind(uid),
  db.prepare('SELECT item,SUM(quantity) quantity,SUM(CASE WHEN expires_at>? THEN quantity ELSE 0 END) fresh FROM farm_market_lots WHERE owner_id=? GROUP BY item').bind(FARM_CLOSE_AT,uid),
  db.prepare("SELECT crop_state,price,started_at,expires_at FROM farm_leases WHERE tenant_id=? AND state='active'").bind(uid),
  db.prepare('SELECT remainder_cents FROM farm_market_accounts WHERE user_id=?').bind(uid),
  db.prepare("SELECT attacker_id,defender_id,starts_at,resolves_at,attack_tools,defense_tools,bond,status FROM farm_conflicts WHERE attacker_id=?1 AND status IN('preparing','escrow','uprising','claimable') UNION ALL SELECT attacker_id,defender_id,starts_at,resolves_at,attack_tools,defense_tools,bond,status FROM farm_conflicts WHERE defender_id=?1 AND status IN('preparing','escrow','uprising','claimable')").bind(uid),
  db.prepare("SELECT b.starts_at,b.resolves_at FROM farm_uprising_members m JOIN farm_uprisings u ON u.battle_id=m.battle_id JOIN farm_conflicts b ON b.id=m.battle_id WHERE m.user_id=? AND u.status='forming' AND b.status='uprising'").bind(uid),
 ])
 const wallet=queries[0].results[0] as {balance:number;revision:number}|undefined
 if(!wallet)throw Error('farm_farewell_wallet_unavailable')
 let refund=0
 for(const battle of queries[4].results as FarewellBattle[]){const rules=conflictBattleRules(battle);refund+=battle.attacker_id===uid?rules.fee+battle.attack_tools*rules.toolCost+(battle.status==='preparing'?battle.bond:0):battle.defense_tools*rules.toolCost}
 for(const battle of queries[5].results as {starts_at:number;resolves_at:number}[])refund+=conflictBattleRules(battle).uprisingCost
 const value=farewellValue(row?JSON.parse(row.state):null,FARM_CLOSE_AT,prices,queries[1].results as FarewellLot[],queries[2].results as FarewellLease[],{marketRemainder:Number(queries[3].results[0]?.remainder_cents??0),conflictRefund:refund})
 const total=value.coins+FARM_FAREWELL_BONUS,balance=wallet.balance+total,attempt=crypto.randomUUID()
 if(!Number.isSafeInteger(balance))throw Error('farm_farewell_balance_overflow')
 const result=await db.batch([
  db.prepare(`UPDATE farm_farewell_recipients SET status='paid',asset_coins=?3,bonus=?4,details=?5,state_snapshot=?6,save_revision=?7,wallet_revision=?8,attempt=?9,paid_at=?10
   WHERE batch_id=?2 AND user_id=?1 AND status='pending' AND ${farewellLive}
   AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?1 AND revision=?8)
   AND ((?7 IS NULL AND NOT EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?1)) OR EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?1 AND revision=?7)) RETURNING user_id`)
   .bind(uid,FARM_FAREWELL_ID,value.coins,FARM_FAREWELL_BONUS,JSON.stringify(value),row?.state??null,row?.revision??null,wallet.revision,attempt,t),
  db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
   SELECT ?1,'farm-farewell-assets',?2,?3||'-assets',?4,?5,?6 WHERE ?4>0 AND EXISTS(SELECT 1 FROM farm_farewell_recipients WHERE attempt=?3)`)
   .bind(uid,FARM_FAREWELL_ID,attempt,value.coins,wallet.balance+value.coins,t),
  db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
   SELECT ?1,'farm-farewell-bonus',?2,?3||'-bonus',?4,?5,?6 WHERE EXISTS(SELECT 1 FROM farm_farewell_recipients WHERE attempt=?3)`)
   .bind(uid,FARM_FAREWELL_ID,attempt,FARM_FAREWELL_BONUS,balance,t),
  db.prepare('UPDATE coin52_wallets SET balance=?,revision=revision+1,updated_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM farm_farewell_recipients WHERE attempt=?)').bind(balance,t,uid,attempt),
  // Keep the original save for the memorial archive. Revision invalidates stale in-flight actions.
  db.prepare('UPDATE farm_saves SET revision=revision+1 WHERE user_id=? AND EXISTS(SELECT 1 FROM farm_farewell_recipients WHERE attempt=?)').bind(uid,attempt),
  db.prepare("INSERT OR IGNORE INTO title_awards(user_id,title,source,created_at,levels) SELECT ?,'oldfarmer','farm-farewell-20261028',?,5200 WHERE EXISTS(SELECT 1 FROM farm_farewell_recipients WHERE attempt=?)").bind(uid,t,attempt),
 ])
 return {paid:result[0].results.length===1,amount:total}
}
export async function runFarmFarewell(db:D1Database,t:number){
 if(!farmClosed(t))return {pending:true}
 await db.prepare('INSERT OR IGNORE INTO farm_farewell_batches(id,closes_at,created_at) VALUES(?,?,?)').bind(FARM_FAREWELL_ID,FARM_CLOSE_AT,t).run()
 const batch=await db.prepare('SELECT status FROM farm_farewell_batches WHERE id=?').bind(FARM_FAREWELL_ID).first<{status:string}>()
 if(batch?.status==='complete')return {complete:true}
 const [pending,quotes]=await db.batch<Record<string,unknown>>([
  db.prepare("SELECT user_id FROM farm_farewell_recipients WHERE batch_id=? AND status='pending' AND retry_at<=? ORDER BY retry_at,user_id LIMIT 8").bind(FARM_FAREWELL_ID,t),
  db.prepare('SELECT item,price_cents FROM farm_farewell_prices WHERE batch_id=?').bind(FARM_FAREWELL_ID),
 ])
 const prices=Object.fromEntries(quotes.results.map(r=>[String(r.item),Number(r.price_cents)]))
 let paid=0,failed=0
 for(const r of pending.results){
  const uid=Number(r.user_id)
  const eligible=await db.prepare(`SELECT 1 WHERE ${farewellLive}`).bind(uid).first()
  if(!eligible){await db.prepare("UPDATE farm_farewell_recipients SET status='skipped' WHERE batch_id=? AND user_id=? AND status='pending'").bind(FARM_FAREWELL_ID,uid).run();continue}
  try{if((await settleFarmFarewellUser(db,uid,t,prices)).paid)paid++}catch{failed++;console.error('farm_farewell_retry',uid);await db.prepare("UPDATE farm_farewell_recipients SET failures=failures+1,retry_at=? WHERE batch_id=? AND user_id=? AND status='pending'").bind(t+300,FARM_FAREWELL_ID,uid).run()}
 }
 await db.prepare("UPDATE farm_farewell_batches SET status='complete',completed_at=? WHERE id=? AND status='settling' AND NOT EXISTS(SELECT 1 FROM farm_farewell_recipients WHERE batch_id=? AND status='pending')").bind(t,FARM_FAREWELL_ID,FARM_FAREWELL_ID).run()
 return {paid,failed}
}
