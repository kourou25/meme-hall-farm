import {MARKET_ITEMS} from './market-stock'
import {fail} from '../lib/http'

// Server-side filtering covers the entire public shelf; only 60 lots are returned.
export function shopQuery(db:D1Database,url:string,t:number){
 const q=new URL(url).searchParams,sort=q.get('shop_sort')||'expiry',kind=q.get('shop_kind')||'',search=(q.get('shop_q')||'').trim(),source=q.get('shop_source')||'',item=q.get('item')||''
 const sorts:Record<string,[string,string]>={expiry:['l.expires_at','ASC'],fresh:['l.expires_at','DESC'],price:['g.price_cents','ASC'],price_desc:['g.price_cents','DESC'],quantity:['l.quantity','DESC'],newest:['l.born_at','DESC']}
 if(!sorts[sort]||!['','crop','animal','fish'].includes(kind)||!['','player','initial'].includes(source)||search.length>60)fail(400,'商店筛选无效')
 const integer=(key:string,max:number)=>{const raw=q.get(key);if(!raw)return 0;const n=Number(raw);if(!Number.isSafeInteger(n)||n<0||n>max)fail(400,'商店价格或数量范围无效');return n}
 const max=integer('shop_max',100000000),minQty=integer('shop_qty',10000),fresh=integer('shop_fresh',604800)
 const where=['l.owner_id=0','l.quantity>0','l.expires_at>?'],args:(string|number)[]=[t+fresh]
 const keys=MARKET_ITEMS.filter(c=>(!item||c.key===item)&&(!kind||c.kind===kind)&&(!search||c.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))).map(c=>c.key)
 if(item||kind||search){where.push('l.item IN (SELECT value FROM json_each(?))');args.push(JSON.stringify(keys))}
 if(max){where.push('(g.price_cents*110+99)/100<=?');args.push(max)}
 if(minQty){where.push('l.quantity>=?');args.push(minQty)}
 if(source)where.push(source==='initial'?"l.id LIKE 'initial-%'":"l.id NOT LIKE 'initial-%'")
 const [column,direction]=sorts[sort],signature=JSON.stringify([sort,item,kind,search,source,max,minQty,fresh]),cursor=q.get('shop_after')
 if(cursor){let a:unknown;try{a=JSON.parse(cursor)}catch{return fail(400,'商店分页位置无效')}if(!Array.isArray(a)||a.length!==3||!Number.isSafeInteger(a[0])||typeof a[1]!=='string'||a[1].length>100||a[2]!==signature)return fail(400,'筛选已变化，请重新加载商店');where.push(`(${column}${direction==='ASC'?'>':'<'}? OR (${column}=? AND l.id>?))`);args.push(a[0],a[0],a[1])}
 return {statement:db.prepare(`SELECT l.*,g.price_cents,${column} AS shop_sort_value FROM farm_market_lots l JOIN farm_market_goods g ON g.item=l.item WHERE ${where.join(' AND ')} ORDER BY ${column} ${direction},l.id ASC LIMIT 61`).bind(...args),signature}
}
