import {Hono} from 'hono'
import type {Ctx} from '../types'
import {needUser} from '../services/auth'
import {boundedJson,fail,sameOrigin} from '../lib/http'
import {now} from '../lib/time'
import {marketEnabled,enrollMarket,tradeMarket} from '../farm/market'
import {MARKET_ITEMS} from '../farm/market-stock'
import {MARKET_RULES} from '../farm/market-rules'
import {farmActionLimit} from '../farm/action-limit'
import {shopQuery} from '../farm/market-shop'
import {marketQuotes} from '../farm/market-quotes'
import {sellMarketBatch,type BulkLot} from '../farm/market-bulk'
export const farmMarket=new Hono<Ctx>()
farmMarket.get('/api/farm/market/history',async c=>{
 needUser(c);const item=c.req.query('item'),t=now()
 if(!MARKET_ITEMS.some(i=>i.key===item))return fail(400,'请选择有效物产')
 const snapshot=await marketQuotes(c.env.DB,c.req.url,t,item,typeof caches==='undefined'?undefined:caches.default)
 c.header('Cache-Control','private, no-store')
 return c.json({item,points:snapshot.rows.filter(p=>Number(p.tick_at)>=t-86400),quotes_at:snapshot.sampled_at,server_time:t})
})
farmMarket.get('/api/farm/market',async c=>{
 const uid=needUser(c).id,t=now(),item=c.req.query('item'),page=c.req.query('before')
 if(item&&!MARKET_ITEMS.some(i=>i.key===item)||page&&(!/^\d+$/.test(page)||!Number.isSafeInteger(Number(page))))return fail(400,'行情筛选无效')
 const shelf=shopQuery(c.env.DB,c.req.url,t)
 const [account,goods]=await Promise.all([
  c.env.DB.prepare('SELECT remainder_cents FROM farm_market_accounts WHERE user_id=?').bind(uid).first<{remainder_cents:number}>(),
  marketQuotes(c.env.DB,c.req.url,t,undefined,typeof caches==='undefined'?undefined:caches.default),
 ])
 // At most 61 rows from each indexed owner range. Details never poll farm JSON.
 const query=`SELECT l.*,g.price_cents FROM farm_market_lots l JOIN farm_market_goods g ON g.item=l.item WHERE l.owner_id=? AND l.quantity>0 ${item?'AND l.item=?':''} ${page?'AND l.rowid<?':''} ORDER BY l.rowid DESC LIMIT 61`
 const args=(id:number)=>[id,...item?[item]:[],...page?[Number(page)]:[]]
 const [mine,shop,owned]=await c.env.DB.batch<Record<string,unknown>>([
  c.env.DB.prepare(query.replace('SELECT l.*,','SELECT l.rowid AS cursor,l.*,')).bind(...args(uid)),
  shelf.statement,
  c.env.DB.prepare('SELECT item,sum(quantity) AS quantity FROM farm_market_lots WHERE owner_id=? AND quantity>0 GROUP BY item').bind(uid),
 ])
 const items=mine.results.slice(0,60)
 // Show base references before the first harvest without inserting idle goods
 // or generating hundreds of unchanged price ticks in D1.
 const quotes=new Map(goods.rows.map(g=>[String(g.item),g]))
 const listedGoods=MARKET_ITEMS.map(spec=>quotes.get(spec.key)??{item:spec.key,base_cents:spec.price*100,price_cents:spec.price*100,fresh_qty:0,effective_qty:0,sold_flow:0,bought_flow:0,tick_at:0,reference_only:true})
 c.header('Cache-Control','private, no-store')
 return c.json({enabled:await marketEnabled(c.env.DB),active:!!account,owned_counts:Object.fromEntries(owned.results.map(r=>[r.item,r.quantity])),remainder_cents:account?.remainder_cents??0,rules:MARKET_RULES,catalog:MARKET_ITEMS,goods:listedGoods,quotes_at:goods.sampled_at,lots:items,next:mine.results.length>60?items.at(-1)?.cursor:null,shop:shop.results.slice(0,60),shop_next:shop.results.length>60?JSON.stringify([shop.results[59].shop_sort_value,shop.results[59].id,shelf.signature]):null,server_time:t})
})
farmMarket.post('/api/farm/market',async c=>{
 sameOrigin(c);const uid=needUser(c).id,b=await boundedJson(c,16384),t=now()
 if(typeof b.id!=='string'||!/^[a-zA-Z0-9-]{16,64}$/.test(b.id))return fail(400,'交易编号无效')
 await farmActionLimit(c.env.DB,uid,t,6)
 if(b.kind==='sell_batch'){
  const lots=b.lots as BulkLot[]
  if(Object.keys(b).some(k=>!['id','kind','lots'].includes(k))||!Array.isArray(lots)||lots.length<1||lots.length>60||new Set(lots.map(l=>l?.id)).size!==lots.length||lots.some(l=>!l||typeof l.id!=='string'||l.id.length>80||Object.keys(l).some(k=>!['id','quantity','price','total'].includes(k))||![l.quantity,l.price,l.total].every(Number.isSafeInteger)||l.quantity<1||l.quantity>10000||l.price<1||l.total<0))return fail(400,'批量出售参数无效，单次最多60批')
  try{return c.json(await sellMarketBatch(c.env.DB,uid,b.id,lots,t))}catch(e){if(e instanceof Error&&['D币余额不足或超出可结算范围','仓库数量不足或已满','所选来源的库存不足'].includes(e.message))return fail(400,e.message);throw e}
 }
 if(b.kind==='enroll'){
  if(Object.keys(b).some(k=>!['id','kind'].includes(k)))return fail(400,'开通参数无效')
  return c.json(await enrollMarket(c.env.DB,uid,b.id,t))
 }
 if(Object.keys(b).some(k=>!['id','kind','lot','quantity','price','expected_total'].includes(k))||!['buy','sell'].includes(String(b.kind))||typeof b.lot!=='string'||b.lot.length>80||!Number.isSafeInteger(b.quantity)||Number(b.quantity)<1||Number(b.quantity)>MARKET_RULES.maxTrade||!Number.isSafeInteger(b.price)||Number(b.price)<1||b.expected_total!==undefined&&(!Number.isSafeInteger(b.expected_total)||Number(b.expected_total)<0))return fail(400,'交易参数无效，数量为1至10000')
 try{return c.json(await tradeMarket(c.env.DB,uid,b as {id:string;kind:'buy'|'sell';lot:string;quantity:number;price:number},t))}catch(e){if(e instanceof Error&&['D币余额不足或超出可结算范围','仓库数量不足或已满','所选来源的库存不足'].includes(e.message))return fail(400,e.message);throw e}
})
