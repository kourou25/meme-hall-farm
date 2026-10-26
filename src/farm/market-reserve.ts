import {MARKET_ITEMS} from './market-stock'
import {shelfLife} from './market-rules'

// A small permanent catalogue; bounded supply, not an infinite mint on page reads.
export const RESERVE_ITEMS=['crop','animal','fish'].flatMap(kind=>MARKET_ITEMS.filter(i=>i.kind===kind).slice(0,8).map(i=>({...i,target:kind==='crop'?80:kind==='animal'?40:24})))
export async function replenishMarket(db:D1Database,t:number){
 const tick=Math.floor(t/600)*600
 const data=RESERVE_ITEMS.map(i=>({item:i.key,target:i.target,base:i.price*100,expires:tick+Math.max(7200,shelfLife(i.seconds))}))
 // Correlated inventory probes use (owner_id,item,expires_at); player stock is never scanned.
 return db.prepare(`INSERT OR IGNORE INTO farm_market_supply_grants(id,item,quantity,base_cents,born_at,expires_at)
 SELECT 'reserve-'||?1||'-'||item,item,target-stock,base,?1,expires FROM (
 SELECT json_extract(j.value,'$.item') AS item,json_extract(j.value,'$.target') AS target,
 json_extract(j.value,'$.base') AS base,json_extract(j.value,'$.expires') AS expires,
 COALESCE((SELECT SUM(quantity) FROM farm_market_lots WHERE owner_id=0 AND item=json_extract(j.value,'$.item') AND expires_at>?2 AND quantity>0),0) AS stock
 FROM json_each(?3) j) WHERE stock<target/2`).bind(tick,t,JSON.stringify(data)).run()
}
