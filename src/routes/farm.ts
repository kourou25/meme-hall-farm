import {Hono} from 'hono'
import type {Ctx} from '../types'
import {needUser,isOwner} from '../services/auth'
import {boundedJson,fail,sameOrigin} from '../lib/http'
import {now} from '../lib/time'
import {sha256} from '../lib/crypto'
import {farmBadgeStatements} from '../farm/badges'
import {farmSocial} from './farm-social'
import {farmLeases} from './farm-leases'
import {farmLeaseScene,leaseSceneView,applyFarmSceneActions} from '../farm/lease-scene'
import {farmWallet,farmWalletActionStatements} from '../farm/wallet'
import {ensureCoinWallet} from '../farm/coin-packets'
import {marketStockStatements} from '../farm/market-stock'
import {farmMarket} from './farm-market'
import {farmConflict} from './farm-conflict'
import {farmActionLimit} from '../farm/action-limit'
import {GUARDIANS,GUARDIAN_RULES} from '../farm/guardian'
import {ANIMALS,RANCH_RULES} from '../farm/ranch'
import {FISH,PIGS,LEISURE_RULES} from '../farm/leisure'
import {FISHING_ITEMS,FISHING_RODS,FISHING_LOOT_RULES} from '../farm/fishing-catalog'
import {newFarm,projectFarm,CROPS,TREE_KINDS,ACHIEVEMENTS,EXPANSIONS,type FarmState} from '../farm/rules'
import {farmClosed,FARM_CLOSE_AT} from '../farm/lifecycle'
import {farmFarewell} from './farm-farewell'
type Save={revision:number;state:string;updated_at:number;balance?:number}
export const farm=new Hono<Ctx>()
farm.use('/api/farm/*',async(c,next)=>{needUser(c);c.header('cache-control','no-store');if(farmClosed(now())&&!['/api/farm/wallet','/api/farm/farewell'].includes(c.req.path))return c.json({error:'农场已暂别，资产与补偿正在按批次结算，请查看纪念页。',code:'farm_closed',closes_at:FARM_CLOSE_AT},410);await next()})
farm.route('/',farmFarewell)
farm.route('/',farmSocial)
farm.route('/',farmLeases)
farm.route('/',farmMarket)
farm.route('/',farmConflict)
const view=(row:Save,t:number)=>{const {receipts,...state}=projectFarm(JSON.parse(row.state) as FarmState,t);if(state.fishing?.cast?.v===3)delete state.fishing.cast._secret;if(row.balance!==undefined)state.coins=row.balance;return {revision:row.revision,state,server_time:t}}
async function lockedView(db:D1Database,uid:number,row:Save,t:number){return leaseSceneView(view(row,t),await farmLeaseScene(db,uid,t))}
farm.get('/api/farm/wallet',async c=>{
 const user=needUser(c),raw=c.req.query('before'),before=raw===undefined?Number.MAX_SAFE_INTEGER:Number(raw)
 if(raw!==undefined&&(!/^[1-9]\d{0,15}$/.test(raw)||!Number.isSafeInteger(before)))return fail(400,'流水游标无效')
 const row=await farmWallet(c.env.DB,user.id,now())
 if(!row)await ensureCoinWallet(c.env.DB,user.id,now())
 const wallet=row||await c.env.DB.prepare('SELECT balance FROM coin52_wallets WHERE user_id=?').bind(user.id).first<{balance:number}>()
 if(!wallet)return fail(409,'钱包状态已变化，请刷新后重试')
 const [ledger,migration]=await c.env.DB.batch<Record<string,unknown>>([
  c.env.DB.prepare('SELECT id,kind,ref,delta,balance_after,created_at FROM coin52_ledger WHERE user_id=? AND id<? ORDER BY id DESC LIMIT 21').bind(user.id,before),
  c.env.DB.prepare('SELECT imported_coins,compensation,created_at FROM farm_migrations WHERE user_id=?').bind(user.id),
 ])
 const rows=ledger.results.slice(0,20)
 return c.json({balance:wallet.balance,rows,next:ledger.results.length>20?rows.at(-1)!.id:null,migration:migration.results[0]??null})
})
farm.get('/api/farm/state',async c=>{
 const user=needUser(c),t=now()
 let row=await c.env.DB.prepare('SELECT revision,state,updated_at FROM farm_saves WHERE user_id=?').bind(user.id).first<Save>()
 if(!row){
  await c.env.DB.prepare(`INSERT OR IGNORE INTO farm_saves(user_id,state,updated_at,owner_operated_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND disabled=0 AND kind='user') AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?)`).bind(user.id,JSON.stringify(newFarm(t)),t,t,user.id,user.id).run()
  row=await c.env.DB.prepare('SELECT revision,state,updated_at FROM farm_saves WHERE user_id=?').bind(user.id).first<Save>()
 }
 if(!row)return fail(403,'账号暂不可用')
 const synced=await farmWallet(c.env.DB,user.id,t)
 if(!synced)return fail(409,'农场正在同步，请稍后重试')
 const display={...synced,state:JSON.stringify({...JSON.parse(synced.state),coins:synced.balance})}
 const visible=await lockedView(c.env.DB,user.id,display,t)
 return c.json({...visible,catalog:{crops:CROPS,trees:{},achievements:ACHIEVEMENTS.filter(a=>a.id!=='woodworker'||JSON.parse(synced.state).achievements.includes(a.id)),animals:ANIMALS,ranch:RANCH_RULES,expansions:EXPANSIONS,fish:FISH,pigs:PIGS,leisure:LEISURE_RULES,fishingItems:FISHING_ITEMS,fishingRods:FISHING_RODS,fishingLoot:FISHING_LOOT_RULES,guardians:GUARDIANS,guardianRules:GUARDIAN_RULES,allUnlocked:isOwner(c,user)}})
})
farm.post('/api/farm/actions',async c=>{
 sameOrigin(c);const user=needUser(c),body=await boundedJson(c,32768),t=now()
 if(Object.keys(body).some(k=>!['id','revision','actions'].includes(k))||typeof body.id!=='string'||!/^[a-zA-Z0-9-]{16,64}$/.test(body.id)||!Number.isSafeInteger(body.revision)||Number(body.revision)<0)return fail(400,'存档操作格式无效')
 if(!Array.isArray(body.actions)||!body.actions.length||body.actions.length>120)return fail(400,'每次操作需要1至120个有效目标')
 const units=body.actions.reduce((n:number,a:unknown)=>n+(a&&typeof a==='object'&&'type' in a?(a.type==='guardian_skill'?6:a.type==='lease_plant'?2:1):1),0)
 const row=await farmWallet(c.env.DB,user.id,t)
 if(!row)return fail(409,'请先打开农场加载存档')
 const state={...JSON.parse(row.state),coins:row.balance} as FarmState,hash=await sha256(JSON.stringify({revision:body.revision,actions:body.actions})),receipt=state.receipts.find(r=>r.id===body.id)
 if(receipt){if(receipt.hash!==hash)return fail(409,'操作编号已被使用，请刷新存档');return c.json({...await lockedView(c.env.DB,user.id,row,t),duplicate:true,messages:[]})}
 if(row.revision!==body.revision)return c.json({error:'农场进度已在其他页面更新，已加载最新存档，请重新操作',code:'farm_conflict',...await lockedView(c.env.DB,user.id,row,t)},409)
 await farmActionLimit(c.env.DB,user.id,t,units)
 const scene=await farmLeaseScene(c.env.DB,user.id,t),locks=scene.locks
 if(Array.isArray(body.actions)&&body.actions.some(a=>a&&locks.some(l=>l.plot===a.plot)))return fail(400,'这块田地正在出租，租期结束后可以继续使用')
 let result:ReturnType<typeof applyFarmSceneActions>
 try{result=applyFarmSceneActions(state,body.actions,scene.rented,t,{allUnlocked:isOwner(c,user),lockedPlots:locks.map(l=>l.plot)})}catch(e){return fail(400,e instanceof Error?e.message:'农场操作无效')}
 result.state.receipts=[...state.receipts,{id:body.id,hash,revision:row.revision+1}].slice(-32)
 const encoded=JSON.stringify(result.state)
 const awards=farmBadgeStatements(c.env.DB,user.id,encoded,row.revision+1,t,state)
 const changed=result.state.coins!==row.balance
 const base=changed?farmWalletActionStatements(c.env.DB,{userId:user.id,row,encoded,balance:result.state.coins,id:body.id,attempt:crypto.randomUUID(),t}):[c.env.DB.prepare(`UPDATE farm_saves SET state=?1,revision=revision+1,updated_at=?2,owner_operated_at=?2 WHERE user_id=?3 AND revision=?4 AND EXISTS(SELECT 1 FROM users WHERE id=?3 AND disabled=0 AND kind='user') AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?3) RETURNING revision,state,updated_at`).bind(encoded,t,user.id,row.revision)]
 const lots=marketStockStatements(c.env.DB,{userId:user.id,before:state,after:result.state,t,gate:'EXISTS(SELECT 1 FROM farm_saves WHERE user_id=? AND revision=? AND state=?)',bindings:[user.id,row.revision+1,encoded]})
 // All lease mutations also advance the tenant's farm revision. The same CAS
 // receipt gates both records; one statement keeps large batches bounded.
 const leaseData=JSON.stringify(result.leases.map(l=>({id:l.id,crop_state:l.crop_state})))
 const leaseWrites=result.leases.length?[c.env.DB.prepare(`UPDATE farm_leases SET crop_state=(SELECT json_extract(value,'$.crop_state') FROM json_each(?1) WHERE json_extract(value,'$.id')=farm_leases.id),revision=revision+1 WHERE id IN(SELECT json_extract(value,'$.id') FROM json_each(?1)) AND tenant_id=?2 AND state='active' AND EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?2 AND revision=?3 AND state=?4)`).bind(leaseData,user.id,row.revision+1,encoded)]:[]
 const stored=await c.env.DB.batch([...base,...leaseWrites,...awards,...lots])
 const saved=stored[base.length-1].results[0] as Save|undefined
 if(!saved){const latest=await farmWallet(c.env.DB,user.id,t);return c.json({error:'存档发生并发更新，请加载最新进度后重试',code:'farm_conflict',...(latest?await lockedView(c.env.DB,user.id,latest,t):{})},409)}
 const visible=leaseSceneView(view(saved,t),{locks,rented:scene.rented.map(l=>result.leases.find(next=>next.id===l.id)??l)})
 return c.json({...visible,messages:result.messages})
})
