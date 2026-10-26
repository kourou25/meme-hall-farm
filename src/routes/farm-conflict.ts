import {Hono} from 'hono'
import type {Ctx} from '../types'
import {needUser} from '../services/auth'
import {boundedJson,fail,sameOrigin} from '../lib/http'
import {now} from '../lib/time'
import {conflictEnabled,conflictSettings,conflictStakes,launchConflict,defendConflict,joinUprising,releaseConflict,resolveConflict,type Battle} from '../farm/conflict'
import {CONFLICT_RULES as R,conflictBattleRules,conflictDay,conflictDayStart,conflictLoot,type ConflictStance,type ConflictTactic} from '../farm/conflict-rules'
import {MARKET_ITEMS} from '../farm/market-stock'
import {farmActionLimit} from '../farm/action-limit'
export const farmConflict=new Hono<Ctx>()
farmConflict.get('/api/farm/conflict',async c=>{
 const uid=needUser(c).id,db=c.env.DB,t=now(),target=c.req.query('target'),before=c.req.query('before')
 if(target&&(!/^\d+$/.test(target)||!Number.isSafeInteger(Number(target)))||before&&(!/^\d+$/.test(before)||!Number.isSafeInteger(Number(before))))return fail(400,'对抗目标或游标无效')
 const [me,targets,battles,allies,wallet]=await db.batch<Record<string,unknown>>([
  db.prepare('SELECT * FROM farm_conflict_members WHERE user_id=?').bind(uid),
  db.prepare(`SELECT m.user_id,m.stance,m.protected_until,u.username,u.name FROM farm_conflict_members m JOIN users u ON u.id=m.user_id WHERE m.enabled=1 AND m.user_id<>? AND m.user_id>? AND u.disabled=0 AND EXISTS(SELECT 1 FROM farm_conflict_stakes WHERE user_id=m.user_id) ORDER BY m.user_id LIMIT 31`).bind(uid,Number(before??0)),
  db.prepare(`SELECT b.*,a.username AS attacker_name,d.username AS defender_name FROM farm_conflicts b JOIN users a ON a.id=b.attacker_id JOIN users d ON d.id=b.defender_id WHERE b.attacker_id=? OR b.defender_id=? ORDER BY b.starts_at DESC LIMIT 30`).bind(uid,uid),
  db.prepare(`SELECT b.id,b.attacker_id,b.defender_id,b.starts_at,b.resolves_at,u.closes_at,d.username AS defender_name,a.username AS attacker_name FROM farm_conflicts b JOIN farm_uprisings u ON u.battle_id=b.id JOIN users d ON d.id=b.defender_id JOIN users a ON a.id=b.attacker_id WHERE b.status='uprising' AND u.status='forming' AND u.closes_at>? AND b.defender_id<>? AND EXISTS(SELECT 1 FROM farm_conflicts v WHERE v.attacker_id=b.attacker_id AND v.defender_id=? AND v.starts_at>=? AND v.status IN ('escrow','uprising','claimable','claimed')) ORDER BY u.closes_at LIMIT 20`).bind(t,uid,uid,t-86400),
  db.prepare('SELECT balance FROM coin52_wallets WHERE user_id=?').bind(uid),
 ])
 const safe:Record<string,unknown>[]=battles.results.map(raw=>{const {roll,roll_nonce,tactic,...b}=raw;return {...b,rules:conflictBattleRules({starts_at:Number(b.starts_at),resolves_at:Number(b.resolves_at)}),tactic:b.attacker_id===uid||b.status!=='preparing'?tactic:null,...b.status!=='preparing'?{roll,roll_nonce}:{},chance:b.status==='preparing'?null:b.chance}})
 const ids=safe.map(b=>b.id),uprisings=ids.length?(await db.prepare(`SELECT u.battle_id,u.closes_at,u.status,u.chance,u.commitment,CASE WHEN u.status<>'forming' THEN u.roll END AS roll,CASE WHEN u.status<>'forming' THEN u.roll_nonce END AS roll_nonce,(SELECT count(*) FROM farm_uprising_members WHERE battle_id=u.battle_id) AS members FROM farm_uprisings u WHERE u.battle_id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids)).all()).results:[]
 const own=await conflictStakes(db,uid)
 let scout:null|Record<string,unknown>=null
 if(target){
  const targetId=Number(target),m=await db.prepare(`SELECT m.user_id,m.stance,m.protected_until,u.username,
   CASE WHEN json_type(s.state,'$.guardian')='object' THEN 1 ELSE 0 END AS guardian,
   MAX(COALESCE(json_extract(s.state,'$.guardUntil'),0),COALESCE(json_extract(s.state,'$.guardian.protectionUntil'),0)) AS guard_until
   FROM farm_conflict_members m JOIN users u ON u.id=m.user_id LEFT JOIN farm_saves s ON s.user_id=m.user_id
   WHERE m.user_id=? AND m.enabled=1 AND u.disabled=0`).bind(targetId).first<Record<string,unknown>>()
  if(m){
   const [lots,limits]=await Promise.all([conflictStakes(db,targetId),db.prepare(`SELECT
    (SELECT limit_cents-reserved_cents FROM farm_conflict_budgets WHERE user_id=?2 AND day=?3) AS remaining,
    (SELECT count(*) FROM farm_conflicts WHERE attacker_id=?1 AND starts_at>=?4) AS attacks,
    (SELECT count(*) FROM farm_conflicts WHERE defender_id=?2 AND starts_at>=?4) AS defenses,
    EXISTS(SELECT 1 FROM farm_conflicts WHERE defender_id=?2 AND status IN ('preparing','escrow','uprising','claimable')) AS ongoing,
    (SELECT starts_at+?5 FROM farm_conflicts WHERE attacker_id=?1 AND defender_id=?2 ORDER BY starts_at DESC LIMIT 1) AS pair_until`
   ).bind(uid,targetId,conflictDay(t),conflictDayStart(t),R.pairCooldown).first<Record<string,number|null>>()])
   const fresh=lots.filter(l=>l.expires_at>t&&l.cooldown_until<=t),value=fresh.reduce((n,l)=>n+l.pledged*l.price_cents,0),remaining=Math.max(0,limits?.remaining??Math.floor(value/5)),protection=Math.max(Number(m.protected_until),Number(m.guard_until))
   const blocked=targetId===uid?'不能攻击自己的货仓':protection>t?'对方仍在守护或战后保护期':Number(limits?.attacks)>=R.attacksPerDay?'今日发起次数已用完':Number(limits?.defenses)>=R.defensesPerDay?'对方今日承受次数已达上限':limits?.ongoing?'对方有尚未结束的攻防或追索':Number(limits?.pair_until)>t?'对同一农友的2小时冷却尚未结束':''
   scout={...m,protected_until:protection,blocked,remaining_cents:remaining,attacks_left:Math.max(0,R.attacksPerDay-Number(limits?.attacks??0)),pair_until:limits?.pair_until??0,
    lots:fresh.map(l=>({id:l.id,item:l.item,quantity:l.pledged,price_cents:l.price_cents,expires_at:l.expires_at,max_quantity:conflictLoot(l.pledged,l.price_cents,value,remaining)}))}
  }
 }
 return c.json({enabled:await conflictEnabled(db),me:me.results[0]??null,balance:wallet.results[0]?.balance??0,stakes:own,battles:safe,uprisings,allies:allies.results.map(b=>({...b,rules:conflictBattleRules({starts_at:Number(b.starts_at),resolves_at:Number(b.resolves_at)})})),targets:targets.results.slice(0,30),next:targets.results.length>30?targets.results[29].user_id:null,scout,catalog:MARKET_ITEMS,rules:R,server_time:t})
})
farmConflict.post('/api/farm/conflict',async c=>{
 sameOrigin(c);const uid=needUser(c).id,b=await boundedJson(c,1200),t=now(),db=c.env.DB
 if(typeof b.id!=='string'||!/^[a-zA-Z0-9-]{16,64}$/.test(b.id))return fail(400,'操作编号无效')
 await farmActionLimit(db,uid,t,6)
 const kinds:Record<string,string[]>={join:[],join_pledge:['lot','quantity'],leave:[],stance:['stance'],pledge:['lot','quantity'],withdraw:['lot','quantity'],attack:['target','lot','tools','tactic'],raid:['target','lot','tools','tactic'],defend:['battle','tools','stance','sealed'],uprising:['battle'],claim:['battle']}
 const fields=kinds[String(b.kind)];if(!fields||Object.keys(b).some(k=>!['id','kind',...fields].includes(k))||fields.some(k=>!(k in b)))return fail(400,'攻防参数无效')
 if('lot' in b&&(typeof b.lot!=='string'||b.lot.length>80)||'battle' in b&&(typeof b.battle!=='string'||b.battle.length>64)||'quantity' in b&&(!Number.isSafeInteger(b.quantity)||Number(b.quantity)<1||Number(b.quantity)>10000)||'tools' in b&&(!Number.isInteger(b.tools)||Number(b.tools)<0||Number(b.tools)>5)||'target' in b&&(!Number.isSafeInteger(b.target)||Number(b.target)<1)||'tactic' in b&&!['sneak','rush','lure'].includes(String(b.tactic))||'stance' in b&&!['patrol','barrier','decoy'].includes(String(b.stance))||'sealed' in b&&typeof b.sealed!=='boolean')return fail(400,'攻防参数超出范围')
 if(b.kind==='attack'||b.kind==='raid'){
  const result=await launchConflict(db,uid,b as {id:string;kind:'attack'|'raid';target:number;lot:string;tools:number;tactic:ConflictTactic},t)
  if(b.kind==='raid'){
   const battle=await db.prepare('SELECT * FROM farm_conflicts WHERE id=? AND attacker_id=?').bind(b.id,uid).first<Battle>()
   if(battle?.status==='preparing')await resolveConflict(db,battle,t)
   const settled=await db.prepare('SELECT status,chance,release_at FROM farm_conflicts WHERE id=? AND attacker_id=?').bind(b.id,uid).first<{status:string;chance:number;release_at:number}>()
   return c.json({...result,...settled,message:settled?.status==='escrow'?'突袭成功！押金已退，战利品已锁定，15分钟追索期后入仓。':settled?.status==='failed'?'这次突袭被挡住了，押金已补偿守方。':'行动结果已保存，可在战报查看。'})
  }
  return c.json(result)
 }
 if(b.kind==='defend')return c.json(await defendConflict(db,uid,b as {id:string;kind:'defend';battle:string;tools:number;stance:ConflictStance;sealed:boolean},t))
 if(b.kind==='uprising')return c.json(await joinUprising(db,uid,b as {id:string;kind:'uprising';battle:string},t))
 if(b.kind==='claim'){
  const battle=await db.prepare('SELECT * FROM farm_conflicts WHERE id=? AND attacker_id=?').bind(b.battle as string,uid).first<Battle>();if(!battle)return fail(404,'战利品不存在')
  if(battle.status==='claimed')return c.json({claimed:true,duplicate:true})
  if(!['escrow','claimable'].includes(battle.status)||t<battle.release_at)return fail(409,'战利品仍在追索期')
  return c.json(await releaseConflict(db,battle,t))
 }
 return c.json(await conflictSettings(db,uid,b as {id:string;kind:'join'|'join_pledge'|'leave'|'stance'|'pledge'|'withdraw';stance?:ConflictStance;lot?:string;quantity?:number},t))
})
