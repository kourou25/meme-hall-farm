import {fail} from '../lib/http'
import {sha256} from '../lib/crypto'
import {projectFarm,type FarmState} from './rules'
import {applyFarmVisit,applyRanchVisit,cropSneakOffer,ranchSneakOffer,publicFarm} from './social'
import {VISIT_RULES} from './visit-rules'
import {farmWallet} from './wallet'
import {marketStockStatements} from './market-stock'
import {farmBadgeStatements} from './badges'

type Target={plot?:number;animal_id?:string;cycle:string}
export async function visitCooldown(db:D1Database,uid:number,owner:number,t:number){
 const row=await db.prepare(`SELECT
  coalesce((SELECT created_at FROM farm_outings WHERE actor_id=?1 ORDER BY created_at DESC,id DESC LIMIT 1),0)+?3 AS global_until,
  coalesce((SELECT created_at FROM farm_outings WHERE actor_id=?1 AND owner_id=?2 ORDER BY created_at DESC LIMIT 1),0)+?4 AS pair_until`).bind(uid,owner,VISIT_RULES.cooldown,VISIT_RULES.pairCooldown).first<{global_until:number;pair_until:number}>()
 return {global_until:Math.max(t,row!.global_until),pair_until:Math.max(t,row!.pair_until)}
}
export async function visitOuting(db:D1Database,uid:number,owner:number,b:Record<string,unknown>,t:number){
 const sneak=b.mode==='sneak',targets=b.targets as Target[],all=b.all===true
 if(owner===uid||!Number.isSafeInteger(owner)||owner<1||Object.keys(b).some(k=>!['id','place','mode','targets','revision','max_fee','all'].includes(k))||(b.all!==undefined&&!all)||typeof b.id!=='string'||!/^[a-zA-Z0-9-]{16,64}$/.test(b.id)||!['home','ranch'].includes(String(b.place))||!['normal','sneak'].includes(String(b.mode))||!Number.isSafeInteger(b.revision)||Number(b.revision)<0||!Number.isSafeInteger(b.max_fee)||Number(b.max_fee)<0||!Array.isArray(targets)||!targets.length||targets.length>VISIT_RULES.maxTargets)fail(400,'请选择有效目标，最多覆盖60块田地与24只动物，并确认费用')
 const isRanch=(x:Target)=>all?Object.hasOwn(x,'animal_id'):b.place==='ranch'
 if(targets.some(x=>{if(!x||typeof x!=='object'||typeof x.cycle!=='string'||!x.cycle.length||x.cycle.length>160)return true;const ranch=isRanch(x);return Object.keys(x).some(k=>!(ranch?['animal_id','cycle']:['plot','cycle']).includes(k))||(ranch?typeof x.animal_id!=='string'||!x.animal_id.length||x.animal_id.length>100:!Number.isInteger(x.plot)||Number(x.plot)<0||Number(x.plot)>=60)})||new Set(targets.map(x=>isRanch(x)?'animal:'+x.animal_id:'plot:'+x.plot)).size!==targets.length)fail(400,'目标无效或重复')
 // Omit all for older clients so their existing receipt hashes remain valid.
 const hash=await sha256(JSON.stringify({owner,place:b.place,mode:b.mode,revision:b.revision,max_fee:b.max_fee,targets,...all?{all:true}:{}})),readReceipt=()=>db.prepare('SELECT request_hash,result FROM farm_outings WHERE actor_id=? AND request_id=?').bind(uid,b.id).first<{request_hash:string;result:string}>()
 const prior=await readReceipt()
 if(prior){if(prior.request_hash!==hash)fail(409,'操作编号已使用');return {...JSON.parse(prior.result),duplicate:true}}
 const cooldown=await visitCooldown(db,uid,owner,t),until=Math.max(cooldown.global_until,cooldown.pair_until)
 if(until>t)fail(429,`行动冷却中，还需${until-t}秒；同一农友间隔5分钟`,'visit_cooldown')
 const rows=(await db.prepare(`SELECT f.user_id,f.revision,f.state,coalesce(nullif(u.name,''),u.username) AS name FROM farm_saves f JOIN users u ON u.id=f.user_id WHERE f.user_id IN (?,?) AND u.kind='user' AND u.disabled=0 AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=u.id)`).bind(uid,owner).all<{user_id:number;revision:number;state:string;name:string}>()).results
 const host=rows.find(r=>r.user_id===owner),actor=rows.find(r=>r.user_id===uid)
 if(!host||!actor)fail(404,'农场不可访问，请先打开自己的农场')
 if(host!.revision!==b.revision)fail(409,'对方农场已变化，请刷新重新选择')
 const wallet=sneak?await farmWallet(db,uid,t):null
 if(sneak&&!wallet)fail(409,'请先打开自己的农场同步余额')
 if(wallet){actor!.state=wallet.state;actor!.revision=wallet.revision}
 const before=JSON.parse(actor!.state) as FarmState
 let ownerState=projectFarm(JSON.parse(host!.state),t),visitor=projectFarm(before,t),fee=0
 if(wallet)visitor.coins=wallet.balance
 const outcomes:Array<{plot:number;animal_id?:string;cycle:string;crop:string;name:string;success:boolean;early:boolean;fee:number;chance:number}>=[]
 for(const target of targets){
  const ranch=isRanch(target)
  const animal=ranch?ownerState.ranch!.animals.find(a=>a.id===target.animal_id):undefined,plot=!ranch?ownerState.plots[target.plot!]:undefined
  const offer=sneak?(ranch&&animal?ranchSneakOffer(ownerState,animal,t):plot?cropSneakOffer(ownerState,plot,t):null):null
  if(sneak&&!offer)fail(409,'所选目标已不满足潜入条件，请刷新重新选择')
  let result:ReturnType<typeof applyFarmVisit>|ReturnType<typeof applyRanchVisit>
  try{result=ranch?applyRanchVisit(ownerState,visitor,{type:'animal_steal',animal_id:target.animal_id!,cycle:target.cycle},t,sneak):applyFarmVisit(ownerState,visitor,{type:'steal',plot:target.plot!,cycle:target.cycle},t,sneak)}catch(e){fail(409,e instanceof Error?e.message:'目标已变化')}
  const success=!sneak||crypto.getRandomValues(new Uint32Array(1))[0]/4294967296<offer!.chance
  fee+=offer?.fee??0
  outcomes.push({plot:'index' in result!?result!.index:target.plot!,...ranch?{animal_id:target.animal_id}:{},cycle:target.cycle,crop:result!.crop,name:offer?.name??result!.crop,success,early:offer?.early??false,fee:offer?.fee??0,chance:offer?.chance??1})
  if(success){ownerState=result!.owner;visitor=result!.visitor}
 }
 if(fee!==b.max_fee)fail(409,'行动费用已变化，请重新查看并确认报价')
 if(visitor.coins<fee)fail(400,'D币不足，未执行行动')
 visitor.coins-=fee
 const won=outcomes.filter(x=>x.success),attempt=crypto.randomUUID(),actorJSON=JSON.stringify(visitor),ownerJSON=JSON.stringify(ownerState),gate='EXISTS(SELECT 1 FROM farm_outings WHERE attempt=?)'
 const result={message:sneak?`潜入${targets.length}处，成功${won.length}处，消耗${fee} D币；失败目标未损失物产`:`摘取${won.length}份物产，已放入背包`,outcomes,fee,...all?{all:true}:{},cooldown:{global_until:t+VISIT_RULES.cooldown,pair_until:t+VISIT_RULES.pairCooldown}}
 const entries=won.map((x,i)=>({...x,request_id:i?b.id+':'+i:b.id,attempt:attempt+':'+i}))
 const sql=[db.prepare(`INSERT OR IGNORE INTO farm_outings(actor_id,owner_id,request_id,request_hash,attempt,mode,place,fee,result,created_at)
  SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10
  WHERE EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?1 AND revision=?11)
   AND EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?2 AND revision=?12)
   AND (SELECT count(*) FROM users WHERE id IN (?1,?2) AND kind='user' AND disabled=0)=2
   AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id IN (?1,?2))
   AND NOT EXISTS(SELECT 1 FROM farm_outings WHERE actor_id=?1 AND created_at>?10-?13)
   AND NOT EXISTS(SELECT 1 FROM farm_outings WHERE actor_id=?1 AND owner_id=?2 AND created_at>?10-?14)
   AND (?8=0 OR EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?1 AND revision=?15 AND balance>=?8)) RETURNING id`)
  .bind(uid,owner,b.id,hash,attempt,b.mode,b.place,fee,JSON.stringify(result),t,actor!.revision,host!.revision,VISIT_RULES.cooldown,VISIT_RULES.pairCooldown,wallet?.wallet_revision??-1),
  ...won.length?[db.prepare(`UPDATE farm_saves SET state=?,revision=revision+1,updated_at=? WHERE user_id=? AND ${gate}`).bind(ownerJSON,t,owner,attempt)]:[],
  db.prepare(`UPDATE farm_saves SET state=?,revision=revision+1,updated_at=? WHERE user_id=? AND ${gate}`).bind(actorJSON,t,uid,attempt),
  ...fee>0?[
   db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at) SELECT ?,'farm-sneak',?,?,?, ?,? WHERE ${gate}`).bind(uid,b.id,attempt,-fee,visitor.coins,t,attempt),
   db.prepare(`UPDATE coin52_wallets SET balance=balance-?,revision=revision+1,updated_at=? WHERE user_id=? AND ${gate}`).bind(fee,t,uid,attempt),
  ]:[],
  ...[false,true].flatMap(ranch=>{const rows=entries.filter(x=>!!x.animal_id===ranch);if(!rows.length)return [];const table=ranch?'farm_ranch_visits':'farm_visits';return [db.prepare(`INSERT INTO ${table}(actor_id,owner_id,request_id,request_hash,attempt,cycle,plot,kind,crop,amount,created_at)
   SELECT ?,?,json_extract(value,'$.request_id'),?,json_extract(value,'$.attempt'),json_extract(value,'$.cycle'),json_extract(value,'$.plot'),?,json_extract(value,'$.crop'),1,? FROM json_each(?) WHERE ${gate}`).bind(uid,owner,hash,ranch?'animal_steal':'steal',t,JSON.stringify(rows),attempt)]}),
  ...won.length?farmBadgeStatements(db,uid,actorJSON,actor!.revision+1,t,before):[],
  ...marketStockStatements(db,{userId:uid,before,after:visitor,t,gate,bindings:[attempt]}),
 ]
 const written=await db.batch(sql)
 if(!written[0].results.length){const retry=await readReceipt();if(retry?.request_hash===hash)return {...JSON.parse(retry.result),duplicate:true};fail(409,'状态或行动冷却已变化，本次没有扣费，请刷新')}
 return {...result,farm:{owner:{id:owner,name:host!.name},revision:host!.revision+(won.length?1:0),server_time:t,...publicFarm(ownerState,t),cooldown:result.cooldown}}
}
