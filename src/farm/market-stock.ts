import {CROPS,type FarmState} from './rules'
import {ANIMALS} from './ranch'
import {FISH} from './leisure'
import {shelfLife} from './market-rules'
import {stockBreakdown} from './stock-origin'
export const MARKET_ITEMS=[
 ...CROPS.map(c=>({key:'crop:'+c.id,id:c.id,kind:'crop',name:c.name,price:c.sellPrice,seconds:c.seconds,frame:c.frame})),
 ...ANIMALS.map(c=>({key:'animal:'+c.id,id:c.id,kind:'animal',name:c.product,price:c.sellPrice,seconds:c.seconds,frame:c.frame})),
 ...FISH.map(c=>({key:'fish:'+c.id,id:c.id,kind:'fish',name:c.name,price:c.price,seconds:3600,frame:c.frame})),
]
export function inventoryCounts(s:FarmState):Record<string,number>{return Object.fromEntries(MARKET_ITEMS.map(i=>[i.key,i.kind==='crop'?s.produce[i.id as keyof typeof s.produce]??0:i.kind==='animal'?s.ranch?.products[i.id]??0:s.fishing?.basket[i.id]??0]))}
export function changeInventory(s:FarmState,key:string,n:number){
 const spec=MARKET_ITEMS.find(i=>i.key===key);if(!spec)throw Error('商品不存在')
 const store:Record<string,number>|undefined=spec.kind==='crop'?s.produce:spec.kind==='animal'?s.ranch?.products:s.fishing?.basket
 const next=(store?.[spec.id]??0)+n
 // Harvests can exceed the purchase cap. Outgoing trades must still be able
 // to reduce that inventory, including one small lot at a time in a batch.
 if(!store||!Number.isSafeInteger(n)||!Number.isSafeInteger(next)||next<0||n>0&&next>(spec.kind==='fish'?1000:10000))throw Error('仓库数量不足或已满')
 store[spec.id]=next
}
// New harvests use their real acquisition bucket. Historical imports have a
// separately labelled seven-day transition period and an auditable snapshot.
export function marketStockStatements(db:D1Database,p:{userId:number;before:FarmState;after:FarmState;t:number;gate:string;bindings:(string|number)[]}){
 if(!p.after.market)return []
 const before=inventoryCounts(p.before),after=inventoryCounts(p.after),born=Math.floor(p.t/600)*600
 const entries=MARKET_ITEMS.flatMap(i=>{
  // A single official batch may sell old stock and harvest new stock. Net
  // inventory alone would lose the new lot; restore the consumed legacy part.
  const legacyUsed=(p.before.market?.legacy[i.key]??0)-(p.after.market?.legacy[i.key]??0)
  const n=(after[i.key]??0)-(before[i.key]??0)+Math.max(0,legacyUsed);if(n<=0)return []
  const old=stockBreakdown(p.before,i.key,before[i.key]??0),next=stockBreakdown(p.after,i.key,after[i.key]??0)
  const legacyStolen=(p.before.market?.legacyOrigins[i.key]?.stolen??0)-(p.after.market?.legacyOrigins[i.key]?.stolen??0)
  const stolen=Math.min(n,Math.max(0,next.stolen-old.stolen+Math.max(0,legacyStolen)))
  return ([['grown',n-stolen],['stolen',stolen]] as const).filter(([,q])=>q>0).map(([source,quantity])=>({id:crypto.randomUUID(),item:i.key,source,quantity,base:i.price*100,born,expires:born+shelfLife(i.seconds)}))
 })
 return marketLotStatements(db,{userId:p.userId,entries,t:born,gate:p.gate,bindings:p.bindings})
}
export function marketLotStatements(db:D1Database,p:{userId:number;entries:{id:string;item:string;source:string;quantity:number;base:number;born:number;expires:number}[];t:number;gate:string;bindings:(string|number)[]}){
 if(!p.entries.length)return []
 const data=JSON.stringify(p.entries),gate=p.gate,args=p.bindings,born=p.t
 return [
  db.prepare(`INSERT OR IGNORE INTO farm_market_goods(item,base_cents,price_cents,tick_at,fresh_at) SELECT json_extract(value,'$.item'),json_extract(value,'$.base'),json_extract(value,'$.base'),?,? FROM json_each(?) WHERE ${gate}`).bind(born,born,data,...args),
  db.prepare(`INSERT INTO farm_market_lots(id,owner_id,item,source,quantity,born_at,expires_at) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.item'),json_extract(value,'$.source'),json_extract(value,'$.quantity'),json_extract(value,'$.born'),json_extract(value,'$.expires') FROM json_each(?) WHERE ${gate}
   ON CONFLICT(owner_id,item,source,born_at,expires_at,cooldown_until,expired) DO UPDATE SET quantity=quantity+excluded.quantity,revision=revision+1`).bind(p.userId,data,...args),
  db.prepare(`UPDATE farm_market_goods SET fresh_seconds=fresh_seconds+(SELECT sum(json_extract(value,'$.quantity')*(json_extract(value,'$.expires')-farm_market_goods.fresh_at)) FROM json_each(?) WHERE json_extract(value,'$.item')=farm_market_goods.item),fresh_qty=fresh_qty+(SELECT sum(json_extract(value,'$.quantity')) FROM json_each(?) WHERE json_extract(value,'$.item')=farm_market_goods.item),revision=revision+1 WHERE item IN(SELECT json_extract(value,'$.item') FROM json_each(?)) AND ${gate}`).bind(data,data,data,...args),
 ]
}
