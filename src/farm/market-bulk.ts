import {farmWallet} from './wallet'
import {projectFarm,type FarmState} from './rules'
import {changeInventory,inventoryCounts} from './market-stock'
import {consumeStock} from './stock-origin'
import {marketMoney,marketSplit} from './market-rules'
import {sha256} from '../lib/crypto'
import {fail} from '../lib/http'
import {communityProgressStatements} from '../community-growth'
import type {MarketLot} from './market'
export type BulkLot={id:string;quantity:number;price:number;total:number}
export async function sellMarketBatch(db:D1Database,uid:number,id:string,requested:BulkLot[],t:number){
 if(!Array.isArray(requested)||!requested.length||requested.length>60||new Set(requested.map(l=>l?.id)).size!==requested.length||requested.some(l=>!l||typeof l.id!=='string'||![l.quantity,l.price,l.total].every(Number.isSafeInteger)||l.quantity<1||l.quantity>10000||l.price<1||l.total<0))return fail(400,'批量出售参数无效')
 const hash=await sha256(JSON.stringify(requested)),prior=async()=>{const r=await db.prepare('SELECT request_hash,result FROM farm_market_receipts WHERE user_id=? AND request_id=?').bind(uid,id).first<{request_hash:string;result:string}>();if(!r)return null;if(r.request_hash!==hash)fail(409,'操作编号已被使用');return {...JSON.parse(r.result),duplicate:true}}
 const done=await prior();if(done)return done
 const row=await farmWallet(db,uid,t);if(!row)return fail(409,'请先打开农场')
 const [acc,rows]=await Promise.all([
  db.prepare('SELECT remainder_cents,revision FROM farm_market_accounts WHERE user_id=?').bind(uid).first<{remainder_cents:number;revision:number}>(),
  db.prepare(`SELECT l.*,g.price_cents,g.split_carry,g.revision AS good_revision FROM json_each(?) j CROSS JOIN farm_market_lots l ON l.id=json_extract(j.value,'$.id') JOIN farm_market_goods g ON g.item=l.item WHERE l.owner_id=?`).bind(JSON.stringify(requested),uid).all<MarketLot&{price_cents:number;split_carry:number;good_revision:number}>(),
 ])
 if(!acc||rows.results.length!==requested.length)return fail(409,'库存已变化，请刷新')
 const s=projectFarm(JSON.parse(row.state) as FarmState,t);if(!s.market)return fail(409,'请先开通行情仓库')
 const lots=rows.results.map(l=>{const q=requested.find(r=>r.id===l.id)!;const rotten=t>=l.expires_at,total=Math.floor(l.price_cents*q.quantity/(rotten?10:1));if(l.cooldown_until>t||q.quantity>l.quantity-l.locked_quantity||q.price!==l.price_cents||q.total!==total)fail(409,'库存、保质期或报价已变化，请刷新后确认');return {...l,sell:q.quantity,rotten,total}})
 const goods=new Map<string,{item:string;revision:number;carry:number;sold:number;removed:number;seconds:number}>(),transfers=[]
 for(const l of lots){
  const g=goods.get(l.item)??{item:l.item,revision:l.good_revision,carry:l.split_carry,sold:0,removed:0,seconds:0};goods.set(l.item,g)
  const split=l.rotten?{shop:0,carry:g.carry}:marketSplit(l.sell,g.carry);g.carry=split.carry;g.sold+=l.rotten?0:l.sell
  const removed=l.expired?0:l.sell-split.shop;g.removed+=removed;g.seconds+=removed*l.expires_at
  if(split.shop)transfers.push({id:crypto.randomUUID(),item:l.item,source:l.source,quantity:split.shop,born:l.born_at,expires:l.expires_at})
  const old=inventoryCounts(s)[l.item];changeInventory(s,l.item,-l.sell)
  if(!l.item.startsWith('fish:'))consumeStock(s,l.item,old,l.sell,l.source==='market'?undefined:l.source)
 }
 const total=lots.reduce((n,l)=>n+l.total,0),quantity=lots.reduce((n,l)=>n+l.sell,0),money=marketMoney(row.balance,acc.remainder_cents,total);s.coins=money.balance
 const attempt=crypto.randomUUID(),gate='EXISTS(SELECT 1 FROM farm_market_receipts WHERE attempt=?)',lotJson=JSON.stringify(lots.map(l=>({id:l.id,revision:l.revision,quantity:l.sell}))),goodJson=JSON.stringify([...goods.values()]),transferJson=JSON.stringify(transfers)
 const result={kind:'sell_batch',batches:lots.length,quantity,total_cents:total,balance:money.balance,remainder_cents:money.remainder}
 const writes=[
  db.prepare(`INSERT OR IGNORE INTO farm_market_receipts(user_id,request_id,request_hash,attempt,kind,quantity,total_cents,result,created_at)
   SELECT ?1,?2,?3,?4,'sell_batch',?5,?6,?7,?8 WHERE EXISTS(SELECT 1 FROM users WHERE id=?1 AND disabled=0 AND kind='user') AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?1)
   AND EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?1 AND revision=?9) AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?1 AND revision=?10) AND EXISTS(SELECT 1 FROM farm_market_accounts WHERE user_id=?1 AND revision=?11)
   AND NOT EXISTS(SELECT 1 FROM json_each(?12) j LEFT JOIN farm_market_lots l ON l.id=json_extract(j.value,'$.id') WHERE l.id IS NULL OR l.owner_id<>?1 OR l.revision<>json_extract(j.value,'$.revision'))
   AND NOT EXISTS(SELECT 1 FROM json_each(?13) j LEFT JOIN farm_market_goods g ON g.item=json_extract(j.value,'$.item') WHERE g.item IS NULL OR g.revision<>json_extract(j.value,'$.revision'))
   AND (SELECT count(*) FROM farm_market_receipts WHERE user_id=?1 AND created_at>=?8-60)<30 RETURNING attempt`).bind(uid,id,hash,attempt,quantity,total,JSON.stringify(result),t,row.revision,row.wallet_revision,acc.revision,lotJson,goodJson),
  db.prepare(`UPDATE farm_market_lots SET quantity=quantity-(SELECT json_extract(value,'$.quantity') FROM json_each(?) WHERE json_extract(value,'$.id')=farm_market_lots.id),revision=revision+1 WHERE id IN(SELECT json_extract(value,'$.id') FROM json_each(?)) AND ${gate}`).bind(lotJson,lotJson,attempt),
  db.prepare(`INSERT INTO farm_market_lots(id,owner_id,item,source,quantity,born_at,expires_at) SELECT json_extract(value,'$.id'),0,json_extract(value,'$.item'),json_extract(value,'$.source'),json_extract(value,'$.quantity'),json_extract(value,'$.born'),json_extract(value,'$.expires') FROM json_each(?) WHERE ${gate} ON CONFLICT(owner_id,item,source,born_at,expires_at,cooldown_until,expired) DO UPDATE SET quantity=quantity+excluded.quantity,revision=revision+1`).bind(transferJson,attempt),
  db.prepare(`UPDATE farm_market_goods SET fresh_seconds=fresh_seconds-(SELECT json_extract(value,'$.seconds')-json_extract(value,'$.removed')*farm_market_goods.fresh_at FROM json_each(?1) WHERE json_extract(value,'$.item')=farm_market_goods.item),fresh_qty=fresh_qty-(SELECT json_extract(value,'$.removed') FROM json_each(?1) WHERE json_extract(value,'$.item')=farm_market_goods.item),sold_flow=sold_flow+(SELECT json_extract(value,'$.sold') FROM json_each(?1) WHERE json_extract(value,'$.item')=farm_market_goods.item),split_carry=(SELECT json_extract(value,'$.carry') FROM json_each(?1) WHERE json_extract(value,'$.item')=farm_market_goods.item),revision=revision+1 WHERE item IN(SELECT json_extract(value,'$.item') FROM json_each(?1)) AND EXISTS(SELECT 1 FROM farm_market_receipts WHERE attempt=?2)`).bind(goodJson,attempt),
  db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at) SELECT ?,'farm-market',?,?,?,?,? WHERE ${gate}`).bind(uid,id,attempt,money.delta,money.balance,t,attempt),
  db.prepare(`UPDATE coin52_wallets SET balance=?,revision=revision+1,updated_at=? WHERE user_id=? AND ${gate}`).bind(money.balance,t,uid,attempt),
  db.prepare(`UPDATE farm_market_accounts SET remainder_cents=?,revision=revision+1 WHERE user_id=? AND ${gate}`).bind(money.remainder,uid,attempt),
  db.prepare(`UPDATE farm_saves SET state=?,revision=revision+1,updated_at=? WHERE user_id=? AND ${gate}`).bind(JSON.stringify(s),t,uid,attempt),
  db.prepare(`DELETE FROM farm_market_lots WHERE id IN(SELECT json_extract(value,'$.id') FROM json_each(?)) AND quantity=0 AND ${gate}`).bind(lotJson,attempt),
  ...communityProgressStatements(db,uid,{market_trades:1,market_sold:Math.floor(total/100)},t,gate,[attempt]),
 ]
 const written=await db.batch(writes);if(!written[0].results.length)return await prior()??fail(409,'库存刚刚发生变化或操作过快，请刷新重试')
 return result
}
