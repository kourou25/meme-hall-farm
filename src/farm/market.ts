import {communityProgressStatements} from '../community-growth'
import {effectiveStock,remainingStockSeconds,type MarketAge} from './market-age.ts'
import {farmWallet} from './wallet'
import {projectFarm,type FarmState} from './rules'
import {inventoryCounts,changeInventory,MARKET_ITEMS} from './market-stock'
import {planMarketImport} from './market-import'
import {MARKET_RULES,marketMoney,marketPrice,marketSplit} from './market-rules'
import {consumeStock} from './stock-origin'
import {sha256} from '../lib/crypto'
import {fail} from '../lib/http'

type Account={remainder_cents:number;revision:number}
export type MarketLot={id:string;owner_id:number;item:string;source:'grown'|'stolen'|'market';quantity:number;locked_quantity:number;born_at:number;expires_at:number;cooldown_until:number;expired:number;revision:number}
type Good=MarketAge&{item:string;base_cents:number;price_cents:number;fresh_qty:number;sold_flow:number;bought_flow:number;split_carry:number;tick_at:number;revision:number}
export async function marketEnabled(db:D1Database){return (await db.prepare("SELECT v FROM site_settings WHERE k='farm.market.enabled'").first<{v:string}>())?.v==='on'}
const receiptGate='EXISTS(SELECT 1 FROM farm_market_receipts WHERE attempt=?)'
const alive=`EXISTS(SELECT 1 FROM users WHERE id=?1 AND kind='user' AND disabled=0) AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?1)`
async function receipt(db:D1Database,uid:number,id:string,hash:string){
 const row=await db.prepare('SELECT request_hash,result FROM farm_market_receipts WHERE user_id=? AND request_id=?').bind(uid,id).first<{request_hash:string;result:string}>()
 if(!row)return null
 if(row.request_hash!==hash)fail(409,'操作编号已被使用，请刷新市场')
 return {...JSON.parse(row.result),duplicate:true}
}
export async function enrollMarket(db:D1Database,uid:number,id:string,t:number){
 const hash=await sha256('market-enroll-v1'),done=await receipt(db,uid,id,hash);if(done)return done
 if(!await marketEnabled(db))return fail(409,'行情市场尚未开放')
 const row=await farmWallet(db,uid,t);if(!row)return fail(409,'请先打开农场')
 const old=projectFarm(JSON.parse(row.state) as FarmState,t)
 if(old.market?.importedAt)return {active:true,duplicate:true}
 const {state:s,entries,quantity}=planMarketImport(old,t)
 const attempt=crypto.randomUUID(),result={active:true,message:`行情仓库已开通，${quantity}份历史物产已迁入并获得7天新鲜保护期；数量和钱包余额保持不变。`}
 const saved=await db.batch([
  db.prepare(`INSERT OR IGNORE INTO farm_market_receipts(user_id,request_id,request_hash,attempt,kind,result,created_at)
   SELECT ?1,?2,?3,?4,'enroll',?5,?6 WHERE EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?1 AND revision=?7) AND ${alive} RETURNING attempt`)
   .bind(uid,id,hash,attempt,JSON.stringify(result),t,row.revision),
  db.prepare(`INSERT INTO farm_market_imports(user_id,original_state,migrated_state,source_revision,quantities,attempt,created_at) SELECT ?,?,?,?,?,?,? WHERE ${receiptGate}`).bind(uid,row.state,JSON.stringify(s),row.revision,JSON.stringify(entries),attempt,t,attempt),
 ])
 if(!saved[0].results.length)return await receipt(db,uid,id,hash)??fail(409,'农场刚刚发生变化，请重试')
 return result
}

export async function tradeMarket(db:D1Database,uid:number,input:{id:string;kind:'buy'|'sell';lot:string;quantity:number;price:number;expected_total?:number},t:number){
 const hash=await sha256(JSON.stringify(input)),done=await receipt(db,uid,input.id,hash);if(done)return done
 if(input.kind==='buy'&&!await marketEnabled(db))return fail(409,'市场暂停新买入，已有库存仍可出售')
 const row=await farmWallet(db,uid,t);if(!row)return fail(409,'请先打开农场')
 const [acc,lot]=await Promise.all([
  db.prepare('SELECT remainder_cents,revision FROM farm_market_accounts WHERE user_id=?').bind(uid).first<Account>(),
  db.prepare('SELECT * FROM farm_market_lots WHERE id=? AND owner_id=?').bind(input.lot,input.kind==='buy'?0:uid).first<MarketLot>(),
 ])
 if(!acc)return fail(409,'请先开通行情仓库')
 if(!lot||lot.quantity-lot.locked_quantity<input.quantity)return fail(409,'批次数量不足或已被冻结，请刷新')
 if(t<lot.cooldown_until)return fail(400,'交易冷却尚未结束，保质期仍在继续')
 const good=await db.prepare('SELECT * FROM farm_market_goods WHERE item=?').bind(lot.item).first<Good>()
 if(!good)return fail(409,'行情尚未就绪')
 const buy=input.kind==='buy',rotten=t>=lot.expires_at
 if(buy&&rotten)return fail(409,'该批次已过期，商店不会出售腐烂商品')
 const unit=buy?Math.ceil(good.price_cents*110/100):good.price_cents
 if(input.price!==unit)return fail(409,'参考价格已变化，请查看新价格后确认')
 const total=Math.floor(unit*input.quantity/(rotten?10:1))
 // Expiry can cross between viewing a batch and submitting it, even if its base price has not changed.
 if(input.expected_total!==undefined&&input.expected_total!==total)return fail(409,'批次保质期或报价已变化，请查看更新后的金额后重新确认')
 const money=marketMoney(row.balance,acc.remainder_cents,buy?-total:total)
 const s=projectFarm(JSON.parse(row.state) as FarmState,t)
 if(!s.market)return fail(409,'行情仓库状态异常，请刷新')
 changeInventory(s,lot.item,buy?input.quantity:-input.quantity)
 if(!buy&&!lot.item.startsWith('fish:'))consumeStock(s,lot.item,inventoryCounts(s)[lot.item]+input.quantity,input.quantity,lot.source==='market'?undefined:lot.source)
 s.coins=money.balance
 const split=buy||rotten?{shop:0,consumed:input.quantity,carry:good.split_carry}:marketSplit(input.quantity,good.split_carry)
 const attempt=crypto.randomUUID(),result={kind:input.kind,item:lot.item,quantity:input.quantity,total_cents:total,rotten,balance:money.balance,remainder_cents:money.remainder,expires_at:lot.expires_at,cooldown_until:buy?t+MARKET_RULES.cooldownSeconds:0}
 const transfer=buy?input.quantity:split.shop,newOwner=buy?uid:0,source=buy?'market':lot.source,cooldown=buy?t+MARKET_RULES.cooldownSeconds:0
 const freshRemoved=buy?0:lot.expired?0:input.quantity-(rotten?0:split.shop)
 const batch=[
  db.prepare(`INSERT OR IGNORE INTO farm_market_receipts(user_id,request_id,request_hash,attempt,kind,item,quantity,total_cents,result,created_at)
   SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10 WHERE ${alive}
   AND EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?1 AND revision=?11)
   AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?1 AND revision=?12)
   AND EXISTS(SELECT 1 FROM farm_market_accounts WHERE user_id=?1 AND revision=?13)
   AND EXISTS(SELECT 1 FROM farm_market_lots WHERE id=?14 AND owner_id=?15 AND revision=?16 AND quantity-locked_quantity>=?7)
   AND EXISTS(SELECT 1 FROM farm_market_goods WHERE item=?6 AND revision=?17)
   AND (SELECT count(*) FROM farm_market_receipts WHERE user_id=?1 AND created_at>=?10-60)<30 RETURNING attempt`)
   .bind(uid,input.id,hash,attempt,input.kind,lot.item,input.quantity,total,JSON.stringify(result),t,row.revision,row.wallet_revision,acc.revision,lot.id,lot.owner_id,lot.revision,good.revision),
  db.prepare(`UPDATE farm_market_lots SET quantity=quantity-?,revision=revision+1 WHERE id=? AND ${receiptGate}`).bind(input.quantity,lot.id,attempt),
  db.prepare(`INSERT INTO farm_market_lots(id,owner_id,item,source,quantity,born_at,expires_at,cooldown_until)
   SELECT ?,?,?,?,?,?,?,? WHERE ?>0 AND ${receiptGate}
   ON CONFLICT(owner_id,item,source,born_at,expires_at,cooldown_until,expired) DO UPDATE SET quantity=quantity+excluded.quantity,revision=revision+1`)
   .bind(crypto.randomUUID(),newOwner,lot.item,source,transfer,lot.born_at,lot.expires_at,cooldown,transfer,attempt),
  db.prepare(`UPDATE farm_market_goods SET fresh_seconds=fresh_seconds-?*(?-fresh_at),fresh_qty=fresh_qty-?,sold_flow=sold_flow+?,bought_flow=bought_flow+?,split_carry=?,revision=revision+1 WHERE item=? AND ${receiptGate}`)
   .bind(freshRemoved,lot.expires_at,freshRemoved,!buy&&!rotten?input.quantity:0,buy?input.quantity:0,split.carry,lot.item,attempt),
  db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at) SELECT ?,'farm-market',?,?,?,?,? WHERE ${receiptGate}`).bind(uid,input.id,attempt,money.delta,money.balance,t,attempt),
  db.prepare(`UPDATE coin52_wallets SET balance=?,revision=revision+1,updated_at=? WHERE user_id=? AND ${receiptGate}`).bind(money.balance,t,uid,attempt),
  db.prepare(`UPDATE farm_market_accounts SET remainder_cents=?,revision=revision+1 WHERE user_id=? AND ${receiptGate}`).bind(money.remainder,uid,attempt),
  db.prepare(`UPDATE farm_saves SET state=?,revision=revision+1,updated_at=? WHERE user_id=? AND ${receiptGate}`).bind(JSON.stringify(s),t,uid,attempt),
  db.prepare(`DELETE FROM farm_market_lots WHERE id=? AND quantity=0 AND ${receiptGate}`).bind(lot.id,attempt),
 ]
 batch.push(...communityProgressStatements(db,uid,{market_trades:1,market_sold:buy?0:Math.floor(total/100)},t,receiptGate,[attempt]))
 const written=await db.batch(batch)
 if(!written[0].results.length)return await receipt(db,uid,input.id,hash)??fail(409,'交易冲突或操作过快，请刷新后重试')
 return result
}

// Bounded expiry work. No JSON farm scan; unswept expiry defers this tick, never
// recalculates price against inventory known to be stale.
export async function settleMarket(db:D1Database,t:number){
 await replenishMarket(db,t)
 const expired=(await db.prepare('SELECT * FROM farm_market_lots WHERE expired=0 AND quantity>0 AND expires_at<=? ORDER BY expires_at,id LIMIT 40').bind(t).all<MarketLot>()).results
 for(const lot of expired){await db.batch([
  db.prepare('UPDATE farm_market_goods SET fresh_seconds=fresh_seconds-?*(?-fresh_at),fresh_qty=fresh_qty-?,revision=revision+1 WHERE item=? AND EXISTS(SELECT 1 FROM farm_market_lots WHERE id=? AND revision=? AND expired=0)').bind(lot.quantity,lot.expires_at,lot.quantity,lot.item,lot.id,lot.revision),
  db.prepare('UPDATE farm_market_lots SET expired=1,revision=revision+1 WHERE id=? AND revision=? AND expired=0').bind(lot.id,lot.revision),
  db.prepare('DELETE FROM farm_market_lots WHERE id=? AND owner_id=0 AND expired=1 AND locked_quantity=0').bind(lot.id),
 ])}
 if(expired.length===40)return {expired:expired.length,ticks:0,pending:true}
 const tick=Math.floor(t/600)*600,goods=(await db.prepare('SELECT * FROM farm_market_goods WHERE tick_at<? ORDER BY item LIMIT 192').bind(tick).all<Good>()).results
 let ticks=0
 for(const g of goods){const spec=MARKET_ITEMS.find(i=>i.key===g.item);if(!spec)continue;const effective=effectiveStock(g,t,spec.seconds),price=marketPrice({price:g.price_cents,base:g.base_cents,fresh:effective,sold:g.sold_flow,bought:g.bought_flow})
  const done=await db.batch([
   db.prepare(`INSERT OR IGNORE INTO farm_market_ticks(item,tick_at,price_cents,fresh_qty,sold,bought,effective_qty) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM farm_market_goods WHERE item=? AND revision=? AND tick_at<?)`).bind(g.item,tick,price,g.fresh_qty,g.sold_flow,g.bought_flow,effective,g.item,g.revision,tick),
   db.prepare(`UPDATE farm_market_goods SET fresh_seconds=?,fresh_at=?,effective_qty=?,price_cents=?,tick_at=?,sold_flow=0,bought_flow=0,revision=revision+1 WHERE item=? AND revision=? AND tick_at<? AND EXISTS(SELECT 1 FROM farm_market_ticks WHERE item=? AND tick_at=?) RETURNING item`).bind(remainingStockSeconds(g,t),Math.max(t,g.fresh_at),effective,price,tick,g.item,g.revision,tick,g.item,tick),
  ]);ticks+=done[1].results.length
 }
 await db.prepare('DELETE FROM farm_market_ticks WHERE (item,tick_at) IN (SELECT item,tick_at FROM farm_market_ticks WHERE tick_at<? ORDER BY tick_at LIMIT 200)').bind(t-7*86400).run()
 return {expired:expired.length,ticks,pending:false}
}
import {replenishMarket} from './market-reserve'
