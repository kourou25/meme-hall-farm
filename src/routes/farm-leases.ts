import {Hono} from 'hono'
import {MAX_FARM_PLOTS} from '../farm/capacity'
import type {Ctx} from '../types'
import {needUser,isOwner} from '../services/auth'
import {sameOrigin,boundedJson,fail} from '../lib/http'
import {now} from '../lib/time'
import {farmWallet} from '../farm/wallet'
import {emptyLeasePlot,LEASE_IDLE,LEASE_DEFAULT,settleFarmLeases,workLease,type Lease} from '../farm/leases'
import type {FarmState} from '../farm/rules'
import {farmActionLimit} from '../farm/action-limit'
import {rentLeaseBatch} from '../farm/lease-batch'
import {buybackLease,leaseBuybackQuote} from '../farm/lease-buyback'

export const farmLeases=new Hono<Ctx>()
const validId=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9-]{16,64}$/.test(v)
const activePair=`(SELECT COUNT(*) FROM users WHERE id IN(?2,?3) AND disabled=0 AND kind='user')=2 AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id IN(?2,?3))`
farmLeases.get('/api/farm/leases',async c=>{
 const u=needUser(c),db=c.env.DB,t=now();await settleFarmLeases(db,t,u.id)
 const [leases,offers,save,locks]=await db.batch<Record<string,unknown>>([
  db.prepare(`SELECT l.*,o.username AS owner_name,n.username AS tenant_name,b.penalty AS buyback_penalty,b.reward AS buyback_reward,b.cooldown_until AS buyback_cooldown FROM farm_leases l JOIN users o ON o.id=l.owner_id JOIN users n ON n.id=l.tenant_id LEFT JOIN farm_lease_buybacks b ON b.lease_id=l.id WHERE (l.owner_id=? OR l.tenant_id=?) AND (l.state='active' OR l.expires_at>?) ORDER BY l.started_at DESC LIMIT 100`).bind(u.id,u.id,t-7*86400),
  db.prepare('SELECT plot,price,days FROM farm_lease_offers WHERE owner_id=? ORDER BY plot').bind(u.id),
  db.prepare('SELECT state,owner_operated_at FROM farm_saves WHERE user_id=?').bind(u.id),
  db.prepare("SELECT plot FROM farm_leases WHERE owner_id=? AND state='active'").bind(u.id),
 ])
 const state=save.results[0]?JSON.parse(String(save.results[0].state)) as FarmState:null
 const locked=new Set(locks.results.map(r=>Number(r.plot)))
 return c.json({leases:leases.results.map(r=>({...r,attempt:undefined,crop_state:JSON.parse(String(r.crop_state))})),offers:offers.results,empty:state?.plots.flatMap((p,i)=>!p.crop&&!locked.has(i)?[i]:[])??[],defaults:LEASE_DEFAULT,server_time:t})
})
farmLeases.get('/api/farm/leases/market',async c=>{
 const u=needUser(c),db=c.env.DB,t=now(),raw=c.req.query('after')||'0.0'
 if(!/^\d{1,12}\.\d{1,12}$/.test(raw))return fail(400,'农友游标无效')
 const [afterTime,afterId]=raw.split('.').map(Number)
 const offered=(await db.prepare(`SELECT o.*,u.username AS name,f.state FROM farm_lease_offers o JOIN farm_saves f ON f.user_id=o.owner_id JOIN users u ON u.id=o.owner_id WHERE o.owner_id<>? AND u.disabled=0 AND u.kind='user' AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=o.owner_id) AND NOT EXISTS(SELECT 1 FROM farm_leases l WHERE l.owner_id=o.owner_id AND l.plot=o.plot AND l.state='active') ORDER BY o.owner_id,o.plot LIMIT 60`).bind(u.id).all<{owner_id:number;plot:number;price:number;days:number;name:string;state:string}>()).results
 const idle=(await db.prepare(`SELECT f.user_id AS owner_id,f.owner_operated_at,u.username AS name,f.state FROM farm_saves f JOIN users u ON u.id=f.user_id WHERE (f.owner_operated_at,f.user_id)>(?,?) AND f.user_id<>? AND f.owner_operated_at<=? AND u.disabled=0 AND u.kind='user' AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=f.user_id) ORDER BY f.owner_operated_at,f.user_id LIMIT 21`).bind(afterTime,afterId,u.id,t-LEASE_IDLE).all<{owner_id:number;owner_operated_at:number;name:string;state:string}>()).results
 const candidates=[...offered.flatMap(o=>{const p=(JSON.parse(o.state) as FarmState).plots[o.plot];return p&&!p.crop?[{owner_id:o.owner_id,name:o.name,plot:o.plot,price:o.price,days:o.days,forced:false}]:[]}),...idle.slice(0,20).flatMap(o=>(JSON.parse(o.state) as FarmState).plots.flatMap((p,plot)=>!p.crop?[{owner_id:o.owner_id,name:o.name,plot,...LEASE_DEFAULT,forced:true}]:[]))]
 const ids=[...new Set(candidates.map(x=>x.owner_id))],locks=ids.length?(await db.prepare(`SELECT owner_id,plot FROM farm_leases WHERE owner_id IN(${ids.map(()=>'?').join(',')}) AND state='active'`).bind(...ids).all<{owner_id:number;plot:number}>()).results:[]
 const unavailable=new Set(locks.map(x=>x.owner_id+':'+x.plot)),seen=new Set<string>(),items=candidates.filter(x=>{const key=x.owner_id+':'+x.plot;if(unavailable.has(key)||seen.has(key))return false;seen.add(key);return true})
 return c.json({items,next:idle.length>20?idle[19].owner_operated_at+'.'+idle[19].owner_id:null,server_time:t})
})
farmLeases.post('/api/farm/leases/offer',async c=>{
 sameOrigin(c);const u=needUser(c),db=c.env.DB,t=now(),b=await boundedJson(c,4096),plots=b.plots??[b.plot]
 if(!Array.isArray(plots)||!plots.length||plots.length>MAX_FARM_PLOTS||new Set(plots).size!==plots.length||plots.some(plot=>!Number.isInteger(plot)||plot<0||plot>=MAX_FARM_PLOTS)||typeof b.remove!=='boolean')return fail(400,'挂牌参数无效')
 await farmActionLimit(db,u.id,t,plots.length)
 if(b.remove){const r=await db.prepare('DELETE FROM farm_lease_offers WHERE owner_id=? AND plot IN(SELECT value FROM json_each(?))').bind(u.id,JSON.stringify(plots)).run();return c.json({removed:true,count:r.meta.changes})}
 if(!Number.isInteger(b.price)||Number(b.price)<1||Number(b.price)>10000||!Number.isInteger(b.days)||Number(b.days)<1||Number(b.days)>7)return fail(400,'租金须为1–10000整数D币，租期1–7天')
 const row=await farmWallet(db,u.id,t),state=row?JSON.parse(row.state) as FarmState:null
 if(!state||plots.some(plot=>!state.plots[plot]||state.plots[plot].crop))return fail(400,'仅能挂牌自己的空地，整批未修改')
 const r=await db.prepare(`INSERT INTO farm_lease_offers(owner_id,plot,price,days,updated_at) SELECT ?1,value,?3,?4,?5 FROM json_each(?2) WHERE EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?1 AND revision=?6) AND NOT EXISTS(SELECT 1 FROM farm_leases WHERE owner_id=?1 AND plot IN(SELECT value FROM json_each(?2)) AND state='active') ON CONFLICT(owner_id,plot) DO UPDATE SET price=excluded.price,days=excluded.days,updated_at=excluded.updated_at RETURNING plot`).bind(u.id,JSON.stringify(plots),b.price,b.days,t,row!.revision).all()
 return r.results.length?c.json({offered:true,count:r.results.length}):fail(409,'土地已变化或正在出租，整批未修改，请刷新')
})
farmLeases.post('/api/farm/leases/rent-batch',async c=>{
 sameOrigin(c);const u=needUser(c),b=await boundedJson(c,16384)
 return c.json(await rentLeaseBatch(c.env.DB,u.id,b,now()))
})
farmLeases.post('/api/farm/leases/rent',async c=>{
 sameOrigin(c);const u=needUser(c),db=c.env.DB,t=now(),b=await boundedJson(c,2048)
 if(!validId(b.id)||!Number.isSafeInteger(b.owner_id)||Number(b.owner_id)===u.id||!Number.isInteger(b.plot)||Number(b.plot)<0||Number(b.plot)>=MAX_FARM_PLOTS||typeof b.forced!=='boolean'||b.confirm!==true)return fail(400,'请确认租金和期限后再租用')
 const id=u.id+'-'+b.id,prior=await db.prepare('SELECT id,price,expires_at FROM farm_leases WHERE id=? AND tenant_id=?').bind(id,u.id).first()
 if(prior)return c.json({...prior,duplicate:true})
 const owner=Number(b.owner_id),plot=Number(b.plot);await settleFarmLeases(db,t,owner)
 const ownerRow=await farmWallet(db,owner,t),tenant=await farmWallet(db,u.id,t),p=ownerRow?(JSON.parse(ownerRow.state) as FarmState).plots[plot]:null
 if(!p||p.crop||!tenant)return fail(409,'请先加载自己的农场，并选择农友的空地')
 const offer=b.forced?LEASE_DEFAULT:await db.prepare('SELECT price,days FROM farm_lease_offers WHERE owner_id=? AND plot=?').bind(owner,plot).first<{price:number;days:number}>()
 if(!offer||b.price!==offer.price||b.days!==offer.days)return fail(409,'挂牌价格或租期已变化，请重新确认')
 if(tenant.balance<offer.price)return fail(400,'D币余额不足')
 const attempt=crypto.randomUUID(),expires=t+offer.days*86400,gate='EXISTS(SELECT 1 FROM farm_leases WHERE attempt=?)'
 const result=await db.batch([
  db.prepare(`INSERT OR IGNORE INTO farm_leases(id,owner_id,tenant_id,plot,price,started_at,expires_at,forced,state,crop_state,attempt)
   SELECT ?1,?2,?3,?4,?5,?6,?7,?8,'active',?9,?10 WHERE ${activePair}
   AND EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?2 AND revision=?11 AND (?8=0 OR owner_operated_at<=?6-${LEASE_IDLE}))
   AND EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?3 AND revision=?12)
   AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?3 AND revision=?13 AND balance>=?5)
   AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?2 AND balance<=9007199254740991-?5)
   AND (?8=1 OR EXISTS(SELECT 1 FROM farm_lease_offers WHERE owner_id=?2 AND plot=?4 AND price=?5 AND days=?14))
   AND NOT EXISTS(SELECT 1 FROM farm_leases WHERE owner_id=?2 AND plot=?4 AND state='active') RETURNING id`)
   .bind(id,owner,u.id,plot,offer.price,t,expires,b.forced?1:0,JSON.stringify(emptyLeasePlot()),attempt,ownerRow!.revision,tenant.revision,tenant.wallet_revision,offer.days),
  db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at) SELECT user_id,CASE WHEN user_id=? THEN 'farm-rent-pay' ELSE 'farm-rent-income' END,?,?,CASE WHEN user_id=? THEN -? ELSE ? END,balance+CASE WHEN user_id=? THEN -? ELSE ? END,? FROM coin52_wallets WHERE user_id IN(?,?) AND ${gate}`)
   .bind(u.id,id,attempt,u.id,offer.price,offer.price,u.id,offer.price,offer.price,t,u.id,owner,attempt),
  db.prepare(`UPDATE coin52_wallets SET balance=balance+CASE WHEN user_id=? THEN -? ELSE ? END,revision=revision+1,updated_at=? WHERE user_id IN(?,?) AND ${gate}`).bind(u.id,offer.price,offer.price,t,u.id,owner,attempt),
  db.prepare(`UPDATE farm_saves SET revision=revision+1 WHERE user_id IN(?,?) AND ${gate}`).bind(u.id,owner,attempt),
  db.prepare(`DELETE FROM farm_lease_offers WHERE owner_id=? AND plot=? AND ${gate}`).bind(owner,plot,attempt),
 ])
 if(!result[0].results.length){const done=await db.prepare('SELECT id,price,expires_at FROM farm_leases WHERE id=? AND tenant_id=?').bind(id,u.id).first();return done?c.json({...done,duplicate:true}):fail(409,'土地、余额或主人经营状态已变化，本次未扣租金')}
 return c.json({id,price:offer.price,expires_at:expires,duplicate:false})
})
farmLeases.post('/api/farm/leases/:id/work',async c=>{
 sameOrigin(c);const u=needUser(c),db=c.env.DB,t=now(),b=await boundedJson(c,2048)
 if(!validId(b.id)||!['plant','harvest','pest'].includes(String(b.type))||(b.autoBuy!==undefined&&typeof b.autoBuy!=='boolean'))return fail(400,'租地操作格式无效')
 const lease=await db.prepare('SELECT * FROM farm_leases WHERE id=? AND tenant_id=?').bind(c.req.param('id'),u.id).first<Lease>();if(!lease)return fail(404,'租约不存在')
 try{return c.json(await workLease(db,lease!,u.id,String(b.id),b.type as 'plant'|'harvest'|'pest',b.crop,b.autoBuy===true,t,isOwner(c,u)))}catch(e){if(e instanceof Error&&'status' in e)throw e;return fail(400,e instanceof Error?e.message:'租地操作失败')}
})
farmLeases.get('/api/farm/leases/:id/buyback',async c=>{
 const u=needUser(c),lease=await c.env.DB.prepare('SELECT * FROM farm_leases WHERE id=? AND owner_id=?').bind(c.req.param('id'),u.id).first<Lease>()
 if(!lease)return fail(404,'租约不存在')
 return c.json(await leaseBuybackQuote(c.env.DB,lease,u.id,now()))
})
farmLeases.post('/api/farm/leases/:id/buyback',async c=>{
 sameOrigin(c);const u=needUser(c),b=await boundedJson(c,2048)
 if(!validId(b.id)||!Number.isSafeInteger(b.revision)||!Number.isSafeInteger(b.penalty)||!Number.isSafeInteger(b.reward)||b.confirm!==true)return fail(400,'请查看买回报价后确认')
 const lease=await c.env.DB.prepare('SELECT * FROM farm_leases WHERE id=? AND owner_id=?').bind(c.req.param('id'),u.id).first<Lease>()
 if(!lease)return fail(404,'租约不存在')
 return c.json(await buybackLease(c.env.DB,lease,u.id,String(b.id),{revision:b.revision,penalty:b.penalty,reward:b.reward},now()))
})
