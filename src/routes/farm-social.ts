import {visitBatch} from '../farm/visit-batch'
import {visitOuting,visitCooldown} from '../farm/visit-outing'
import {farmActionLimit} from '../farm/action-limit'
import {Hono} from 'hono'
import {MAX_FARM_PLOTS} from '../farm/capacity'
import type {Ctx} from '../types'
import type {C} from '../types'
import {needUser} from '../services/auth'
import {boundedJson,fail,sameOrigin} from '../lib/http'
import {now} from '../lib/time'
import {sha256} from '../lib/crypto'
import type {FarmState} from '../farm/rules'
import {applyFarmVisit,applyRanchVisit,publicFarm,type VisitAction,type RanchVisitAction} from '../farm/social'
import {farmVisitStatements} from '../farm/visit-store'
import {farmBadgeStatements} from '../farm/badges'
import {marketStockStatements} from '../farm/market-stock'
type Save={user_id:number;revision:number;state:string;name:string;username:string}
const available=`u.kind='user' AND u.disabled=0 AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=u.id)`
const saveQuery=`SELECT f.user_id,f.revision,f.state,u.name,u.username FROM farm_saves f JOIN users u ON u.id=f.user_id WHERE f.user_id=? AND ${available}`
const visible=(s:Save,t:number)=>({owner:{id:s.user_id,name:s.name||s.username},revision:s.revision,server_time:t,...publicFarm(JSON.parse(s.state) as FarmState,t)})
async function traffic(c:C,uid:number){if(c.env.AUTH_RL&&!(await c.env.AUTH_RL.limit({key:'farm-visit:'+uid})).success)fail(429,'请求过于频繁，请稍后再试；重复点击不会加快冷却','visit_rate')}
function number(raw:string|undefined,otherwise:number){if(raw===undefined)return otherwise;const n=Number(raw);if(!raw||!Number.isSafeInteger(n))return fail(400,'分页参数无效');return n}
export const farmSocial=new Hono<Ctx>()
farmSocial.get('/api/farm/loss-ranking',async c=>{
 needUser(c)
 const rows=await c.env.DB.prepare(`SELECT l.user_id AS id,coalesce(nullif(u.name,''),u.username) AS name,l.crops,l.products,l.total
 FROM farm_loss_totals l JOIN users u ON u.id=l.user_id WHERE l.total>0 AND ${available} ORDER BY l.total DESC,l.user_id LIMIT 30`).all()
 return c.json({items:rows.results,next:null})
})
farmSocial.get('/api/farm/neighbors',async c=>{
 const uid=needUser(c).id,after=number(c.req.query('after'),Number.MIN_SAFE_INTEGER)
 const rows=await c.env.DB.prepare(`SELECT f.user_id AS id,coalesce(nullif(u.name,''),u.username) AS name,f.state FROM farm_saves f JOIN users u ON u.id=f.user_id WHERE f.user_id>? AND f.user_id<>? AND ${available} ORDER BY f.user_id LIMIT 21`).bind(after,uid).all<{id:number;name:string;state:string}>()
 const t=now(),items=rows.results.slice(0,20).map(row=>{const projected=publicFarm(JSON.parse(row.state) as FarmState,t);return {id:row.id,name:row.name,plots:projected.plots.length,animals:projected.ranch.animals.length,available_crops:projected.plots.filter(p=>p.status==='stealable').length,available_products:projected.ranch.animals.filter(a=>a.status==='stealable').length,sneak_crops:projected.plots.filter(p=>p.sneak).length,sneak_products:projected.ranch.animals.filter(a=>a.sneak).length,guard_until:projected.guard_until}});return c.json({items,next:rows.results.length>20?items.at(-1)!.id:null})
})
farmSocial.get('/api/farm/visits',async c=>{
 const uid=needUser(c).id,before=number(c.req.query('before'),Number.MAX_SAFE_INTEGER),t=now()
 const rows=await c.env.DB.prepare(`SELECT v.id,v.actor_id,coalesce(nullif(u.name,''),u.username) AS actor_name,v.kind,v.crop,v.amount,v.plot,v.created_at FROM farm_visits v JOIN users u ON u.id=v.actor_id WHERE v.owner_id=? AND v.id<? AND v.created_at>=? ORDER BY v.id DESC LIMIT 21`).bind(uid,before,t-30*86400).all<{id:number}>()
 const items=rows.results.slice(0,20);return c.json({items,next:rows.results.length>20?items.at(-1)!.id:null})
})
farmSocial.get('/api/farm/activity',async c=>{
 const uid=needUser(c).id,t=now(),raw=c.req.query('before'),p=raw?.split(':').map(Number)
 if(p&&(p.length!==3||p.some(n=>!Number.isSafeInteger(n))||p[0]<1||p[1]<0||p[1]>3))return fail(400,'记录分页位置无效')
 const [at,kind,id]=p??[Number.MAX_SAFE_INTEGER,3,Number.MAX_SAFE_INTEGER]
 // 先按索引各取21条再去重；过滤已合并明细也不能扩大扫描窗口。
 const branches=[['farm_visits','created_at','id',0],['farm_ranch_visits','created_at','id',1],['farm_guest_visits','visited_at','actor_id',2],['farm_outings','created_at','id',3]] as const
 const results=await c.env.DB.batch(branches.map(([table,time,key,source])=>c.env.DB.prepare(`WITH page AS (SELECT * FROM ${table} WHERE owner_id=? AND ${time}>=? ${source===3?"AND mode='sneak'":''} AND (${time},${source},${key})<(?,?,?) ORDER BY ${time} DESC,${key} DESC LIMIT 21)
 SELECT v.${key} AS event_id,v.actor_id,coalesce(nullif(u.name,''),u.username) AS actor_name,
 ${source===3?"'sneak' AS kind,NULL AS crop,0 AS amount,NULL AS plot,v.result":source===2?"'visit' AS kind,NULL AS crop,0 AS amount,NULL AS plot,NULL AS result":'v.kind,v.crop,v.amount,v.plot,NULL AS result'},v.${time} AS created_at,${source} AS source
 ,${source<2?"EXISTS(SELECT 1 FROM farm_outings o WHERE o.attempt=substr(v.attempt,1,36) AND o.mode='sneak')":'0'} AS grouped
 FROM page v JOIN users u ON u.id=v.actor_id ORDER BY v.${time} DESC,v.${key} DESC`).bind(uid,t-30*86400,at,kind,id)))
 type Event={event_id:number;created_at:number;source:number;grouped:number}
 const sorted=results.flatMap(r=>r.results as Event[]).sort((a,b)=>b.created_at-a.created_at||b.source-a.source||b.event_id-a.event_id),items=sorted.slice(0,20),last=items.at(-1)
 return c.json({items:items.filter(x=>!x.grouped).map(({grouped,...x})=>({...x,id:`${x.source}:${x.event_id}`})),next:sorted.length>20&&last?`${last.created_at}:${last.source}:${last.event_id}`:null})
})
farmSocial.post('/api/farm/visit/:owner/arrive',async c=>{
 sameOrigin(c);const uid=needUser(c).id,id=number(c.req.param('owner'),0),t=now(),row=await c.env.DB.prepare(saveQuery).bind(id).first<Save>()
 if(!row)return fail(404,'这位用户的农场暂不可访问')
 if(id!==uid)await c.env.DB.prepare(`INSERT INTO farm_guest_visits(owner_id,actor_id,visited_at)
 SELECT ?1,?2,?3 WHERE EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?2)
 AND EXISTS(SELECT 1 FROM users WHERE id=?2 AND disabled=0 AND kind='user')
 AND EXISTS(SELECT 1 FROM users WHERE id=?1 AND disabled=0 AND kind='user')
 AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id IN (?1,?2))
 ON CONFLICT(owner_id,actor_id) DO UPDATE SET visited_at=excluded.visited_at WHERE farm_guest_visits.visited_at<=?3-1800`).bind(id,uid,t).run()
 return c.json({...visible(row!,t),cooldown:await visitCooldown(c.env.DB,uid,id,t)})
})
farmSocial.get('/api/farm/ranch-visits',async c=>{
 const uid=needUser(c).id,before=number(c.req.query('before'),Number.MAX_SAFE_INTEGER),t=now()
 const rows=await c.env.DB.prepare(`SELECT v.id,v.actor_id,coalesce(nullif(u.name,''),u.username) AS actor_name,v.kind,v.crop,v.amount,v.plot,v.created_at FROM farm_ranch_visits v JOIN users u ON u.id=v.actor_id WHERE v.owner_id=? AND v.id<? AND v.created_at>=? ORDER BY v.id DESC LIMIT 21`).bind(uid,before,t-30*86400).all<{id:number}>()
 const items=rows.results.slice(0,20);return c.json({items,next:rows.results.length>20?items.at(-1)!.id:null})
})
farmSocial.get('/api/farm/visit/:owner',async c=>{
 const id=number(c.req.param('owner'),0),row=await c.env.DB.prepare(saveQuery).bind(id).first<Save>()
 if(!row)return fail(404,'这位用户的农场暂不可访问')
 const t=now(),uid=c.get('user')?.id;return c.json({...visible(row,t),...uid?{cooldown:await visitCooldown(c.env.DB,uid,id,t)}:{}})
})
farmSocial.post('/api/farm/visit/:owner',async c=>{
 sameOrigin(c);const uid=needUser(c).id;await traffic(c,uid);const owner=number(c.req.param('owner'),0),body=await boundedJson(c,2048),t=now()
 if(owner===uid)return fail(400,'请在自己的农场操作')
 const ranch=body.type==='animal_steal',table=ranch?'farm_ranch_visits':'farm_visits'
 if(Object.keys(body).some(k=>!(ranch?['id','type','animal_id','cycle','revision']:['id','type','plot','cycle','revision']).includes(k))||typeof body.id!=='string'||!/^[a-zA-Z0-9-]{16,64}$/.test(body.id)||!['water','steal','animal_steal'].includes(String(body.type))||typeof body.cycle!=='string'||body.cycle.length>160||(ranch?(typeof body.animal_id!=='string'||body.animal_id.length>100):(!Number.isInteger(body.plot)||Number(body.plot)<0||Number(body.plot)>=MAX_FARM_PLOTS))||!Number.isSafeInteger(body.revision)||Number(body.revision)<0)return fail(400,'互访操作格式无效')
 const hash=await sha256(JSON.stringify({owner,type:body.type,plot:body.plot,animal_id:body.animal_id,cycle:body.cycle,revision:body.revision}))
 const receipt=await c.env.DB.prepare(`SELECT request_hash FROM ${table} WHERE actor_id=?1 AND request_id=?2 AND NOT EXISTS(SELECT 1 FROM farm_outings WHERE actor_id=?1 AND request_id=?2)`).bind(uid,body.id).first<{request_hash:string}>()
 if(receipt){if(receipt.request_hash!==hash)return fail(409,'操作编号已使用');return c.json({duplicate:true,message:'这次互动已完成，没有重复扣除或获得物品'})}
 if(body.type!=='water')return c.json(await visitOuting(c.env.DB,uid,owner,{id:body.id,place:ranch?'ranch':'home',mode:'normal',revision:body.revision,max_fee:0,targets:[ranch?{animal_id:body.animal_id,cycle:body.cycle}:{plot:body.plot,cycle:body.cycle}]},t))
 await farmActionLimit(c.env.DB,uid,t,1)
 const rows=await c.env.DB.batch([c.env.DB.prepare(saveQuery).bind(owner),c.env.DB.prepare(saveQuery).bind(uid)])
 const host=rows[0].results[0] as Save|undefined,actor=rows[1].results[0] as Save|undefined
 if(!host)return fail(404,'这位用户的农场暂不可访问')
 if(!actor)return fail(409,'请先进入自己的农场加载存档')
 if(host.revision!==body.revision)return fail(409,'对方农场已变化，请刷新后重新选择')
 let result:ReturnType<typeof applyFarmVisit>|ReturnType<typeof applyRanchVisit>
 try{result=ranch?applyRanchVisit(JSON.parse(host.state),JSON.parse(actor.state),body as unknown as RanchVisitAction,t):applyFarmVisit(JSON.parse(host.state),JSON.parse(actor.state),body as unknown as VisitAction,t)}catch(e){return fail(400,e instanceof Error?e.message:'无法进行互动')}
 const attempt=crypto.randomUUID(),actorState=JSON.stringify(result.visitor),written=await c.env.DB.batch([
  ...farmVisitStatements(c.env.DB,{actor:uid,owner,actorRevision:actor.revision,ownerRevision:host.revision,actorState,ownerState:JSON.stringify(result.owner),id:body.id,hash,attempt,cycle:body.cycle,plot:'index' in result?result.index:Number(body.plot),kind:body.type as VisitAction['type']|RanchVisitAction['type'],crop:result.crop,amount:result.amount,t},table),
  ...result.amount>0?farmBadgeStatements(c.env.DB,uid,actorState,actor.revision+1,t):[],
  ...marketStockStatements(c.env.DB,{userId:uid,before:JSON.parse(actor.state),after:result.visitor,t,gate:`EXISTS(SELECT 1 FROM ${table} WHERE attempt=?)`,bindings:[attempt]}),
 ])
 if(!written[0].results.length){
  const retry=await c.env.DB.prepare(`SELECT request_hash FROM ${table} WHERE actor_id=? AND request_id=?`).bind(uid,body.id).first<{request_hash:string}>()
  if(retry?.request_hash===hash)return c.json({duplicate:true,message:'这次互动已完成，没有重复结算'})
  return fail(409,'农场状态已变化、此茬已操作或操作过于频繁，请刷新后重试')
 }
 return c.json({message:result.message,farm:visible({...host,state:JSON.stringify(result.owner),revision:host.revision+1},t)})
})

farmSocial.post('/api/farm/visit/:owner/batch',async c=>{sameOrigin(c);const uid=needUser(c).id;await traffic(c,uid);return c.json(await visitBatch(c.env.DB,uid,number(c.req.param('owner'),0),await boundedJson(c,16384),now()))})
farmSocial.post('/api/farm/visit/:owner/outing',async c=>{sameOrigin(c);const uid=needUser(c).id;await traffic(c,uid);return c.json(await visitOuting(c.env.DB,uid,number(c.req.param('owner'),0),await boundedJson(c,32768),now()))})
