import {communityProgressStatements} from '../community-growth'
import {fail} from '../lib/http'
import {sha256} from '../lib/crypto'
import {farmWallet,type FarmWalletSave} from './wallet'
import {projectFarm,type FarmState} from './rules'
import {changeInventory,inventoryCounts} from './market-stock'
import {addStock,consumeStock} from './stock-origin'
import {protectedUntil} from './guardian'
import type {MarketLot} from './market'
import {CONFLICT_RULES as R,RAID_RULES,conflictBattleRules,conflictChance,conflictDay,conflictDayStart,conflictLoot,conflictRoll,type ConflictStance,type ConflictTactic} from './conflict-rules'

type Member={user_id:number;enabled:number;stance:ConflictStance;joined_at:number;protected_until:number;revision:number}
export type Battle={id:string;attacker_id:number;defender_id:number;lot_id:string;item:string;quantity:number;loot_cents:number;bond:number;attack_tools:number;defense_tools:number;tactic:ConflictTactic;stance:ConflictStance;guardian:number;sealed:number;roll:number;roll_nonce:string;commitment:string;chance:number|null;status:string;starts_at:number;resolves_at:number;release_at:number;revision:number}
type Stake=MarketLot&{pledged:number;stake_revision:number;price_cents:number}
type Check={sql:string;args:(string|number)[]}
type Result=Record<string,unknown>
const gate='EXISTS(SELECT 1 FROM farm_conflict_receipts WHERE attempt=?)'
const live=(uid:number):Check=>({sql:"EXISTS(SELECT 1 FROM users WHERE id=? AND kind='user' AND disabled=0) AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?)",args:[uid,uid]})
const walletCheck=(uid:number,row:FarmWalletSave):Check=>({sql:'EXISTS(SELECT 1 FROM farm_saves WHERE user_id=? AND revision=?) AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=? AND revision=?)',args:[uid,row.revision,uid,row.wallet_revision]})
const memberCheck=(m:Member):Check=>({sql:'EXISTS(SELECT 1 FROM farm_conflict_members WHERE user_id=? AND revision=?)',args:[m.user_id,m.revision]})
const battleCheck=(b:Battle):Check=>({sql:'EXISTS(SELECT 1 FROM farm_conflicts WHERE id=? AND revision=? AND status=?)',args:[b.id,b.revision,b.status]})
const noIncoming=(uid:number):Check=>({sql:"NOT EXISTS(SELECT 1 FROM farm_conflicts WHERE defender_id=? AND status IN ('preparing','escrow','uprising','claimable'))",args:[uid]})
const valid=(ok:unknown,message:string)=>{if(!ok)fail(409,message)}
const event=(db:D1Database,p:{uid:number;actor:number;battle:string;phase:string;body:string;t:number},attempt:string)=>db.prepare(`INSERT OR IGNORE INTO farm_conflict_events(user_id,actor_id,battle_id,phase,body,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(p.uid,p.actor,p.battle,p.phase,p.body,p.t,attempt)
async function prior(db:D1Database,uid:number,id:string,hash:string){const r=await db.prepare('SELECT request_hash,result FROM farm_conflict_receipts WHERE user_id=? AND request_id=?').bind(uid,id).first<{request_hash:string;result:string}>();if(!r)return null;if(r.request_hash!==hash)fail(409,'操作编号已使用');return {...JSON.parse(r.result),duplicate:true}}
async function commit(db:D1Database,p:{uid:number;id:string;hash:string;t:number;result:Result;checks:Check[];write:(attempt:string)=>D1PreparedStatement[]}){
 const attempt=crypto.randomUUID(),checks=p.uid?[live(p.uid),...p.checks]:p.checks
 const r=await db.batch([db.prepare(`INSERT OR IGNORE INTO farm_conflict_receipts(user_id,request_id,request_hash,attempt,result,created_at) SELECT ?,?,?,?,?,? WHERE ${checks.map(c=>'('+c.sql+')').join(' AND ')||'1'} RETURNING attempt`).bind(p.uid,p.id,p.hash,attempt,JSON.stringify(p.result),p.t,...checks.flatMap(c=>c.args)),...p.write(attempt)])
 if(!r[0].results.length)return await prior(db,p.uid,p.id,p.hash)??fail(409,'库存或攻防状态已变化，请刷新后重试')
 return p.result
}
async function wallet(db:D1Database,uid:number,t:number){const row=await farmWallet(db,uid,t);if(!row)return fail(409,'请先打开农场');return row}
async function member(db:D1Database,uid:number){return db.prepare('SELECT * FROM farm_conflict_members WHERE user_id=?').bind(uid).first<Member>()}
function walletWrites(db:D1Database,uid:number,row:FarmWalletSave,delta:number,ref:string,t:number,attempt:string,state?:FarmState){
 const balance=row.balance+delta;valid(Number.isSafeInteger(balance)&&balance>=0,'D币余额不足或超出可结算范围')
 const s=state??projectFarm(JSON.parse(row.state) as FarmState,t);s.coins=balance
 return [
  db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at) SELECT ?,'farm-conflict',?,?,?,?,? WHERE ${gate}`).bind(uid,ref,attempt+':'+uid,delta,balance,t,attempt),
  db.prepare(`UPDATE coin52_wallets SET balance=?,revision=revision+1,updated_at=? WHERE user_id=? AND ${gate}`).bind(balance,t,uid,attempt),
  db.prepare(`UPDATE farm_saves SET state=?,revision=revision+1,updated_at=? WHERE user_id=? AND ${gate}`).bind(JSON.stringify(s),t,uid,attempt),
 ]
}
export async function conflictEnabled(db:D1Database){return (await db.prepare("SELECT v FROM site_settings WHERE k='farm.conflict.enabled'").first<{v:string}>())?.v==='on'}
export async function conflictStakes(db:D1Database,uid:number){return (await db.prepare('SELECT l.*,s.quantity AS pledged,s.revision AS stake_revision,g.price_cents FROM farm_conflict_stakes s JOIN farm_market_lots l ON l.id=s.lot_id JOIN farm_market_goods g ON g.item=l.item WHERE s.user_id=? ORDER BY s.lot_id LIMIT 60').bind(uid).all<Stake>()).results}
export async function conflictSettings(db:D1Database,uid:number,input:{id:string;kind:'join'|'join_pledge'|'leave'|'stance'|'pledge'|'withdraw';stance?:ConflictStance;lot?:string;quantity?:number},t:number){
 const hash=await sha256(JSON.stringify(input)),done=await prior(db,uid,input.id,hash);if(done)return done
 const m=await member(db,uid),result={kind:input.kind,message:'对抗货仓已更新'}
 if(input.kind==='join'){
  valid(await conflictEnabled(db),'对抗玩法尚未开放');const row=await wallet(db,uid,t)
  valid(!!(JSON.parse(row.state) as FarmState).market,'请先开通行情仓库');if(m?.enabled)return {kind:'join',duplicate:true}
  return commit(db,{uid,id:input.id,hash,t,result,checks:[walletCheck(uid,row),m?memberCheck(m):{sql:'NOT EXISTS(SELECT 1 FROM farm_conflict_members WHERE user_id=?)',args:[uid]}],write:a=>[
   db.prepare(`INSERT INTO farm_conflict_members(user_id,joined_at) SELECT ?,? WHERE ${gate} ON CONFLICT(user_id) DO UPDATE SET enabled=1,joined_at=excluded.joined_at,revision=revision+1`).bind(uid,t,a),
  ]})
 }
 const entering=input.kind==='join_pledge',joiningWallet=entering?await wallet(db,uid,t):null
 if(entering){valid(await conflictEnabled(db),'对抗玩法尚未开放');valid(!!(JSON.parse(joiningWallet!.state) as FarmState).market,'请先开通行情仓库')}
 valid(m||entering,'请先加入对抗玩法');const current=m!
 if(input.kind==='stance')return commit(db,{uid,id:input.id,hash,t,result,checks:[memberCheck(current)],write:a=>[db.prepare(`UPDATE farm_conflict_members SET stance=?,revision=revision+1 WHERE user_id=? AND ${gate}`).bind(input.stance!,uid,a)]})
 if(input.kind==='leave'){
  valid(t>=current.joined_at+R.minEnrollment,'请处理完行动并取回物资后退出')
  return commit(db,{uid,id:input.id,hash,t,result,checks:[m?memberCheck(m):{sql:'NOT EXISTS(SELECT 1 FROM farm_conflict_members WHERE user_id=?)',args:[uid]},...(joiningWallet?[walletCheck(uid,joiningWallet)]:[]),noIncoming(uid),{sql:"NOT EXISTS(SELECT 1 FROM farm_conflicts WHERE attacker_id=? AND status IN ('preparing','escrow','uprising','claimable'))",args:[uid]},{sql:'NOT EXISTS(SELECT 1 FROM farm_conflict_stakes WHERE user_id=?)',args:[uid]}],write:a=>[db.prepare(`UPDATE farm_conflict_members SET enabled=0,revision=revision+1 WHERE user_id=? AND ${gate}`).bind(uid,a)]})
 }
 const lot=await db.prepare('SELECT * FROM farm_market_lots WHERE id=? AND owner_id=?').bind(input.lot!,uid).first<MarketLot>()
 valid(lot,'该批次不存在');const l=lot!,n=input.quantity!
 const stake=await db.prepare('SELECT quantity,revision FROM farm_conflict_stakes WHERE lot_id=?').bind(l.id).first<{quantity:number;revision:number}>(),deposit=input.kind==='pledge'||entering
 valid(deposit?(entering||current.enabled)&&t>=l.cooldown_until&&t<l.expires_at&&l.quantity-l.locked_quantity>=n:(stake?.quantity??0)>=n,'可划入或取回的数量不足，或仍在冷却')
 if(deposit)valid(await conflictEnabled(db),'对抗暂停新划入，原有库存仍可取回')
 return commit(db,{uid,id:input.id,hash,t,result,checks:[m?memberCheck(m):{sql:'NOT EXISTS(SELECT 1 FROM farm_conflict_members WHERE user_id=?)',args:[uid]},...(joiningWallet?[walletCheck(uid,joiningWallet)]:[]),noIncoming(uid),{sql:"NOT EXISTS(SELECT 1 FROM farm_conflicts WHERE attacker_id=? AND status='preparing')",args:[uid]},{sql:'EXISTS(SELECT 1 FROM farm_market_lots WHERE id=? AND revision=?)',args:[l.id,l.revision]},stake?{sql:'EXISTS(SELECT 1 FROM farm_conflict_stakes WHERE lot_id=? AND revision=?)',args:[l.id,stake.revision]}:{sql:'NOT EXISTS(SELECT 1 FROM farm_conflict_stakes WHERE lot_id=?) AND (SELECT count(*) FROM farm_conflict_stakes WHERE user_id=?)<60',args:[l.id,uid]}],write:a=>[
  entering?db.prepare(`INSERT INTO farm_conflict_members(user_id,joined_at) SELECT ?,? WHERE ${gate} ON CONFLICT(user_id) DO UPDATE SET enabled=1,joined_at=CASE WHEN enabled=1 THEN joined_at ELSE excluded.joined_at END,revision=revision+1`).bind(uid,t,a):db.prepare(`UPDATE farm_conflict_members SET revision=revision+1 WHERE user_id=? AND ${gate}`).bind(uid,a),
  db.prepare(`UPDATE farm_market_lots SET locked_quantity=locked_quantity+?,revision=revision+1 WHERE id=? AND ${gate}`).bind(deposit?n:-n,l.id,a),
  ...(deposit?[db.prepare(`INSERT INTO farm_conflict_stakes(lot_id,user_id,quantity) SELECT ?,?,? WHERE ${gate} ON CONFLICT(lot_id) DO UPDATE SET quantity=quantity+excluded.quantity,revision=revision+1`).bind(l.id,uid,n,a)]:n===stake!.quantity?[db.prepare(`DELETE FROM farm_conflict_stakes WHERE lot_id=? AND ${gate}`).bind(l.id,a)]:[db.prepare(`UPDATE farm_conflict_stakes SET quantity=quantity-?,revision=revision+1 WHERE lot_id=? AND ${gate}`).bind(n,l.id,a)]),
 ]})
}
export async function launchConflict(db:D1Database,uid:number,input:{id:string;target:number;lot:string;tools:number;tactic:ConflictTactic;kind:'attack'|'raid'},t:number){
 const hash=await sha256(JSON.stringify(input)),done=await prior(db,uid,input.id,hash);if(done)return done
 valid(await conflictEnabled(db),'对抗暂停新行动');valid(uid!==input.target,'不能攻击自己的货仓')
 const rules=input.kind==='raid'?RAID_RULES:R
 const [defender,ar,dr,stakes]=await Promise.all([member(db,input.target),wallet(db,uid,t),wallet(db,input.target,t),conflictStakes(db,input.target)])
 valid(defender?.enabled,'该农友没有开放对抗货仓');valid(JSON.parse(ar.state).market,'请先免费开通行情仓库以接收战利品，无需入仓');valid(defender!.protected_until<=t&&protectedUntil(JSON.parse(dr.state))<=t,'对方仍在守护或战后保护期')
 const l=stakes.find(l=>l.id===input.lot&&l.expires_at>t&&l.cooldown_until<=t);valid(l,'没有可攻击的新鲜批次')
 const goods=stakes.filter(l=>l.expires_at>t&&l.cooldown_until<=t),value=goods.reduce((v,l)=>v+l.pledged*l.price_cents,0)
 const budget=await db.prepare('SELECT limit_cents,reserved_cents FROM farm_conflict_budgets WHERE user_id=? AND day=?').bind(input.target,conflictDay(t)).first<{limit_cents:number;reserved_cents:number}>()
 const limit=budget?.limit_cents??Math.floor(value/5),reserved=budget?.reserved_cents??0,n=conflictLoot(l!.pledged,l!.price_cents,value,limit-reserved)
 valid(n>0,'该货仓已到今日损失上限，或可掠价值不足一份商品')
 const cents=n*l!.price_cents,bond=Math.max(1,Math.ceil(cents/500)),cost=rules.fee+input.tools*rules.toolCost+bond
 valid(ar.balance>=cost,'D币不足以支付行动道具及押金')
 const roll=conflictRoll(),nonce=crypto.randomUUID(),commitment=await sha256(`${input.id}:${roll}:${nonce}`),result={battle:input.id,cost,bond,quantity:n,item:l!.item,maximum_cents:cents,resolves_at:t+rules.prepareSeconds,commitment,message:input.kind==='raid'?'突袭已发起，即时判定结果。':'行动已发起，防守方有3分钟准备。'}
 return commit(db,{uid,id:input.id,hash,t,result,checks:[live(input.target),walletCheck(uid,ar),walletCheck(input.target,dr),memberCheck(defender!),noIncoming(input.target),
  {sql:'EXISTS(SELECT 1 FROM farm_market_lots WHERE id=? AND revision=?) AND EXISTS(SELECT 1 FROM farm_conflict_stakes WHERE lot_id=? AND revision=?)',args:[l!.id,l!.revision,l!.id,l!.stake_revision]},
  {sql:'(SELECT count(*) FROM farm_conflicts WHERE attacker_id=? AND starts_at>=?)<3 AND (SELECT count(*) FROM farm_conflicts WHERE defender_id=? AND starts_at>=?)<2 AND NOT EXISTS(SELECT 1 FROM farm_conflicts WHERE attacker_id=? AND defender_id=? AND starts_at>?)',args:[uid,conflictDayStart(t),input.target,conflictDayStart(t),uid,input.target,t-R.pairCooldown]},
  budget?{sql:'EXISTS(SELECT 1 FROM farm_conflict_budgets WHERE user_id=? AND day=? AND reserved_cents=?)',args:[input.target,conflictDay(t),reserved]}:{sql:'NOT EXISTS(SELECT 1 FROM farm_conflict_budgets WHERE user_id=? AND day=?)',args:[input.target,conflictDay(t)]},
 ],write:a=>[
  ...walletWrites(db,uid,ar,-cost,input.id,t,a),
  db.prepare(`INSERT INTO farm_conflict_budgets(user_id,day,limit_cents,reserved_cents) SELECT ?,?,?,? WHERE ${gate} ON CONFLICT(user_id,day) DO UPDATE SET reserved_cents=reserved_cents+excluded.reserved_cents`).bind(input.target,conflictDay(t),limit,cents,a),
  db.prepare(`INSERT INTO farm_conflicts(id,attacker_id,defender_id,lot_id,item,quantity,loot_cents,bond,attack_tools,tactic,stance,guardian,roll,roll_nonce,commitment,starts_at,resolves_at) SELECT ${Array(17).fill('?').join(',')} WHERE ${gate}`).bind(input.id,uid,input.target,l!.id,l!.item,n,cents,bond,input.tools,input.tactic,defender!.stance,JSON.parse(dr.state).guardian?1:0,roll,nonce,commitment,t,t+rules.prepareSeconds,a),
  event(db,{uid:input.target,actor:uid,battle:input.id,phase:'warning',body:input.kind==='raid'?'货仓受到突袭，默认阵型与守护兽自动迎战；若失守，可在15分钟追索期内发起反击。':'对抗货仓收到行动预警，3分钟内可调整策略、投入防守道具或封仓。',t},a),
 ]})
}
export async function defendConflict(db:D1Database,uid:number,input:{id:string;kind:'defend';battle:string;tools:number;stance:ConflictStance;sealed:boolean},t:number){
 const hash=await sha256(JSON.stringify(input)),done=await prior(db,uid,input.id,hash);if(done)return done
 const b=await db.prepare('SELECT * FROM farm_conflicts WHERE id=? AND defender_id=?').bind(input.battle,uid).first<Battle>();valid(b&&b.status==='preparing'&&t<b.resolves_at,'防守准备期已结束')
 valid(input.tools>=b!.defense_tools,'已投入的防守道具不能撤回');valid(!b!.sealed||input.sealed,'封仓后本次行动不能取消封仓')
 const row=await wallet(db,uid,t),cost=(input.tools-b!.defense_tools)*conflictBattleRules(b!).toolCost;valid(row.balance>=cost,'D币不足以投入防守道具')
 return commit(db,{uid,id:input.id,hash,t,result:{message:'防守已部署',cost},checks:[battleCheck(b!),walletCheck(uid,row)],write:a=>[
  ...walletWrites(db,uid,row,-cost,input.id,t,a),
  db.prepare(`UPDATE farm_conflicts SET defense_tools=?,stance=?,sealed=?,revision=revision+1 WHERE id=? AND ${gate}`).bind(input.tools,input.stance,input.sealed?1:0,b!.id,a),
 ]})
}
// Settling old obligations is independent of the new-action feature switch.
export async function resolveConflict(db:D1Database,b:Battle,t:number){
 if(b.status!=='preparing'||t<b.resolves_at)return
 const rules=conflictBattleRules(b),chance=conflictChance(b),won=b.roll/1000000<chance,quantity=b.sealed?Math.floor(b.quantity/2):b.quantity,success=won&&quantity>0
 const recipient=success?b.attacker_id:b.defender_id,row=await wallet(db,recipient,t),hash=await sha256('resolve:'+b.id)
 return commit(db,{uid:0,id:'resolve:'+b.id,hash,t,result:{battle:b.id,success},checks:[battleCheck(b),walletCheck(recipient,row)],write:a=>[
  ...communityProgressStatements(db,recipient,success?{raid_wins:1}:{defend_wins:1},t,gate,[a]),
  ...walletWrites(db,recipient,row,b.bond,b.id+':bond',t,a),
  db.prepare(`UPDATE farm_conflicts SET status=?,quantity=?,loot_cents=?,chance=?,release_at=?,settled_at=?,revision=revision+1 WHERE id=? AND ${gate}`).bind(success?'escrow':'failed',success?quantity:b.quantity,success?Math.floor(b.loot_cents*quantity/b.quantity):b.loot_cents,chance,success?t+rules.escrowSeconds:0,t,b.id,a),
  db.prepare(`UPDATE farm_conflict_members SET protected_until=MAX(protected_until,?),revision=revision+1 WHERE user_id=? AND ${gate}`).bind(success?t+rules.protectionSeconds:0,b.defender_id,a),
  ...[b.attacker_id,b.defender_id].map(uid=>event(db,{uid,actor:uid===b.attacker_id?b.defender_id:b.attacker_id,battle:b.id,phase:'result',body:success?`进攻成功，战利品进入${rules.escrowSeconds/60}分钟追索托管期。`:'进攻被阻止，押金已补给防守方。',t},a)),
 ]})
}
export async function releaseConflict(db:D1Database,b:Battle,t:number){
 if(!['escrow','claimable'].includes(b.status)||t<b.release_at)return
 const [ar,dr,lot]=await Promise.all([wallet(db,b.attacker_id,t),wallet(db,b.defender_id,t),db.prepare('SELECT * FROM farm_market_lots WHERE id=?').bind(b.lot_id).first<MarketLot>()])
 valid(lot&&lot.locked_quantity>=b.quantity,'战利品冻结记录异常，请联系管理员')
 const l=lot!,attacker=projectFarm(JSON.parse(ar.state),t),defender=projectFarm(JSON.parse(dr.state),t)
 try{changeInventory(attacker,b.item,b.quantity)}catch(e){if(e instanceof Error&&e.message==='仓库数量不足或已满'){
  await db.prepare("UPDATE farm_conflicts SET status='claimable',revision=revision+1 WHERE id=? AND revision=? AND status='escrow'").bind(b.id,b.revision).run();return {claimable:true}
 }throw e}
 const original=inventoryCounts(defender)[b.item];changeInventory(defender,b.item,-b.quantity)
 if(!b.item.startsWith('fish:')){consumeStock(defender,b.item,original,b.quantity,l.source==='market'?undefined:l.source);addStock(attacker,b.item,'stolen',b.quantity)}
 const expired=t>=l.expires_at?1:l.expired,hash=await sha256('release:'+b.id)
 return commit(db,{uid:0,id:'release:'+b.id,hash,t,result:{battle:b.id,claimed:true},checks:[battleCheck(b),walletCheck(b.attacker_id,ar),walletCheck(b.defender_id,dr),{sql:'EXISTS(SELECT 1 FROM farm_market_lots WHERE id=? AND revision=?) AND EXISTS(SELECT 1 FROM farm_conflict_stakes WHERE lot_id=? AND quantity>=?)',args:[l.id,l.revision,l.id,b.quantity]}],write:a=>[
  ...walletWrites(db,b.attacker_id,ar,0,b.id+':goods',t,a,attacker),...walletWrites(db,b.defender_id,dr,0,b.id+':goods',t,a,defender),
  db.prepare(`UPDATE farm_market_lots SET quantity=quantity-?,locked_quantity=locked_quantity-?,revision=revision+1 WHERE id=? AND ${gate}`).bind(b.quantity,b.quantity,l.id,a),
  db.prepare(`DELETE FROM farm_conflict_stakes WHERE lot_id=? AND quantity=? AND ${gate}`).bind(l.id,b.quantity,a),
  db.prepare(`UPDATE farm_conflict_stakes SET quantity=quantity-?,revision=revision+1 WHERE lot_id=? AND ${gate}`).bind(b.quantity,l.id,a),
  db.prepare(`INSERT INTO farm_market_lots(id,owner_id,item,source,quantity,born_at,expires_at,cooldown_until,expired) SELECT ?,?,?,'stolen',?,?,?,?,? WHERE ${gate} ON CONFLICT(owner_id,item,source,born_at,expires_at,cooldown_until,expired) DO UPDATE SET quantity=quantity+excluded.quantity,revision=revision+1`).bind(crypto.randomUUID(),b.attacker_id,b.item,b.quantity,l.born_at,l.expires_at,t,expired,a),
  db.prepare(`UPDATE farm_market_goods SET fresh_seconds=fresh_seconds-?*(?-fresh_at),fresh_qty=fresh_qty-?,revision=revision+1 WHERE item=? AND ${gate}`).bind(expired&&!l.expired?b.quantity:0,l.expires_at,expired&&!l.expired?b.quantity:0,b.item,a),
  db.prepare(`UPDATE farm_conflicts SET status='claimed',revision=revision+1 WHERE id=? AND ${gate}`).bind(b.id,a),
  ...[b.attacker_id,b.defender_id].map(uid=>event(db,{uid,actor:uid===b.attacker_id?b.defender_id:b.attacker_id,battle:b.id,phase:'released',body:'追索期结束，战利品已按原保质期转移入仓。',t},a)),
 ]})
}
export async function joinUprising(db:D1Database,uid:number,input:{id:string;kind:'uprising';battle:string},t:number){
 const hash=await sha256(JSON.stringify(input)),done=await prior(db,uid,input.id,hash);if(done)return done
 const b=await db.prepare('SELECT * FROM farm_conflicts WHERE id=?').bind(input.battle).first<Battle>();valid(b&&['escrow','uprising'].includes(b.status),'该战利品已经不在追索期')
 const rules=conflictBattleRules(b!)
 valid(uid!==b!.attacker_id,'攻击方不能加入追索自己的队伍')
 const up=await db.prepare('SELECT * FROM farm_uprisings WHERE battle_id=?').bind(b!.id).first<{closes_at:number;status:string;revision:number}>()
 if(!up)valid(uid===b!.defender_id&&t+rules.uprisingSeconds<=b!.release_at,`仅受损方能在追索截止前${rules.uprisingSeconds/60}分钟发起起义`)
 else valid(up.status==='forming'&&t<up.closes_at,'起义已结束招募')
 const row=await wallet(db,uid,t);valid(row.balance>=rules.uprisingCost,'D币不足以投入起义补给')
 const checks:Check[]=[battleCheck(b!),walletCheck(uid,row),{sql:'NOT EXISTS(SELECT 1 FROM farm_uprising_members WHERE battle_id=? AND user_id=?) AND (SELECT count(*) FROM farm_uprising_members WHERE battle_id=?)<4',args:[b!.id,uid,b!.id]}]
 if(uid!==b!.defender_id)checks.push({sql:"EXISTS(SELECT 1 FROM farm_conflicts WHERE attacker_id=? AND defender_id=? AND starts_at>=? AND status IN ('escrow','uprising','claimable','claimed'))",args:[b!.attacker_id,uid,t-86400]})
 checks.push(up?{sql:"EXISTS(SELECT 1 FROM farm_uprisings WHERE battle_id=? AND revision=? AND status='forming')",args:[b!.id,up.revision]}:{sql:'NOT EXISTS(SELECT 1 FROM farm_uprisings WHERE battle_id=?)',args:[b!.id]})
 const roll=conflictRoll(),nonce=crypto.randomUUID(),commitment=await sha256(`uprising:${b!.id}:${roll}:${nonce}`)
 return commit(db,{uid,id:input.id,hash,t,result:{message:`已投入${rules.uprisingCost}D补给；${rules.minAllies===1?'可单人追索，组队提高机会':'需2至4名同一攻击方的受损者成队'}，成功后物资归还原主人。`,closes_at:up?.closes_at??t+rules.uprisingSeconds},checks,write:a=>[
  ...walletWrites(db,uid,row,-rules.uprisingCost,input.id,t,a),
  ...(up?[db.prepare(`UPDATE farm_uprisings SET revision=revision+1 WHERE battle_id=? AND ${gate}`).bind(b!.id,a)]:[db.prepare(`INSERT INTO farm_uprisings(battle_id,closes_at,roll,roll_nonce,commitment) SELECT ?,?,?,?,? WHERE ${gate}`).bind(b!.id,t+rules.uprisingSeconds,roll,nonce,commitment,a)]),
  db.prepare(`INSERT INTO farm_uprising_members(battle_id,user_id,joined_at) SELECT ?,?,? WHERE ${gate}`).bind(b!.id,uid,t,a),
  db.prepare(`UPDATE farm_conflicts SET status='uprising',revision=revision+1 WHERE id=? AND ${gate}`).bind(b!.id,a),
 ]})
}
async function resolveUprising(db:D1Database,id:string,t:number){
 const up=await db.prepare("SELECT * FROM farm_uprisings WHERE battle_id=? AND status='forming' AND closes_at<=?").bind(id,t).first<{roll:number;revision:number}>();if(!up)return
 const b=await db.prepare("SELECT * FROM farm_conflicts WHERE id=? AND status='uprising'").bind(id).first<Battle>();if(!b)return
 const rules=conflictBattleRules(b)
 const count=Number((await db.prepare('SELECT count(*) AS n FROM farm_uprising_members WHERE battle_id=?').bind(id).first<{n:number}>())!.n),chance=Math.min(.65,.35+.1*(count-1)),won=count>=rules.minAllies&&up.roll/1000000<chance
 const supporters=won?(await db.prepare('SELECT user_id FROM farm_uprising_members WHERE battle_id=? LIMIT 4').bind(id).all<{user_id:number}>()).results:[]
 const hash=await sha256('uprising-resolve:'+id)
 return commit(db,{uid:0,id:'uprising-resolve:'+id,hash,t,result:{battle:id,recovered:won},checks:[battleCheck(b),{sql:"EXISTS(SELECT 1 FROM farm_uprisings WHERE battle_id=? AND revision=? AND status='forming')",args:[id,up.revision]}],write:a=>[
  ...supporters.flatMap(u=>communityProgressStatements(db,u.user_id,{uprising_wins:1},t,gate,[a])),
  db.prepare(`UPDATE farm_uprisings SET status=?,chance=?,revision=revision+1 WHERE battle_id=? AND ${gate}`).bind(count<rules.minAllies?'insufficient':won?'won':'lost',count<rules.minAllies?0:chance,id,a),
  db.prepare(`UPDATE farm_conflicts SET status=?,revision=revision+1 WHERE id=? AND ${gate}`).bind(won?'recovered':'escrow',id,a),
  ...[b.attacker_id,b.defender_id].map(uid=>event(db,{uid,actor:uid===b.attacker_id?b.defender_id:b.attacker_id,battle:b.id,phase:'uprising',body:won?'起义追索成功，原主人的货仓物资已保全。':count<rules.minAllies?'起义未达到约定人数，物资继续按原托管截止时间处理。':'起义追索失败，物资继续按原托管截止时间处理。',t},a)),
 ]})
}
export async function settleConflicts(db:D1Database,t:number){
 const preparing=(await db.prepare("SELECT * FROM farm_conflicts WHERE status='preparing' AND resolves_at<=? ORDER BY resolves_at,id LIMIT 10").bind(t).all<Battle>()).results
 const uprisings=(await db.prepare("SELECT battle_id FROM farm_uprisings WHERE status='forming' AND closes_at<=? ORDER BY closes_at,battle_id LIMIT 10").bind(t).all<{battle_id:string}>()).results
 const escrow=(await db.prepare("SELECT * FROM farm_conflicts WHERE status='escrow' AND release_at<=? ORDER BY release_at,id LIMIT 10").bind(t).all<Battle>()).results
 // One busy account must not prevent other due actions from settling.
 for(const b of preparing)await resolveConflict(db,b,t).catch(()=>console.error('farm_conflict_resolve_failed',b.id))
 for(const u of uprisings)await resolveUprising(db,u.battle_id,t).catch(()=>console.error('farm_uprising_resolve_failed',u.battle_id))
 for(const b of escrow)await releaseConflict(db,b,t).catch(()=>console.error('farm_conflict_release_failed',b.id))
 return {preparing:preparing.length,uprisings:uprisings.length,escrow:escrow.length}
}
