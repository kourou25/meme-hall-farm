import {cropMaxSeconds} from '../shared/crop-care.ts'
import {applyFarmActions,CROPS,type FarmState} from './rules'
import {farmWallet} from './wallet'
import {farmBadgeStatements} from './badges'
import {fail} from '../lib/http'
import {marketStockStatements} from './market-stock'
import {farmActionLimit} from './action-limit'

export type Lease={id:string;owner_id:number;tenant_id:number;plot:number;price:number;started_at:number;expires_at:number;forced:number;state:'active'|'ended';crop_state:string;revision:number;attempt:string}
export const LEASE_IDLE=48*3600
export const LEASE_DEFAULT={price:10,days:1}
export const emptyLeasePlot=()=>({tilled:true,crop:null,plantedAt:0,wateredAt:null})
export async function farmLeaseLocks(db:D1Database,userId:number,t:number){
 return (await db.prepare("SELECT plot,expires_at FROM farm_leases WHERE owner_id=? AND state='active' AND expires_at>?").bind(userId,t).all<{plot:number;expires_at:number}>()).results
}
// The receipt is the single transaction gate for the lease, inventory and wallet.
// A response can be lost without replaying a harvest or a seed purchase.
export async function workLease(db:D1Database,lease:Lease,actor:number,requestId:string,type:'plant'|'harvest'|'pest'|'end',crop:unknown,autoBuy:boolean,t:number,allUnlocked=false){
 if(await db.prepare('SELECT 1 FROM farm_lease_actions WHERE lease_id=? AND request_id=? AND actor_id=?').bind(lease.id,requestId,actor).first())return {duplicate:true}
 if(lease.tenant_id!==actor||lease.state!=='active')fail(409,'租约已结束或不属于你')
 if(type==='end'&&lease.expires_at>t)fail(400,'租期尚未结束')
 if((type==='plant'||type==='pest')&&lease.expires_at<=t)fail(400,'租期已结束，等待自动收获归还')
 // Replays above are free; automatic expiry must not be blocked by player quotas.
 if(type!=='end')await farmActionLimit(db,actor,t,type==='plant'?2:1)
 const row=await farmWallet(db,actor,t);if(!row)fail(409,'请先加载自己的农场')
 const original={...JSON.parse(row!.state),coins:row!.balance} as FarmState,plot=JSON.parse(lease.crop_state) as FarmState['plots'][number]
 let actions:Record<string,unknown>[]=[]
 if(type==='plant'){
  const spec=CROPS.find(c=>c.id===crop);if(!spec||t+cropMaxSeconds(spec.seconds)>lease.expires_at)fail(400,'租期不足以覆盖成熟及最多10%虫害缓冲，请选择生长更快的种子')
  actions=[{type:'plant',plot:0,crop,autoBuy},{type:'water',plot:0}]
 }else if(type==='pest')actions=[{type:'pest',plot:0}]
 else if(type==='harvest'||plot.crop)actions=[{type:'harvest',plot:0}]
 const result=actions.length?applyFarmActions({...original,plots:[plot]},actions,t,{allUnlocked}):{state:{...original,plots:[plot]},messages:[] as string[]}
 const nextPlot=JSON.stringify(result.state.plots[0]);result.state.plots=original.plots
 const encoded=JSON.stringify(result.state),delta=result.state.coins-row!.balance,attempt=crypto.randomUUID(),gate='EXISTS(SELECT 1 FROM farm_lease_actions WHERE attempt=?)'
 const batch=[
  db.prepare(`INSERT OR IGNORE INTO farm_lease_actions(lease_id,request_id,actor_id,attempt,created_at)
   SELECT ?1,?2,?3,?4,?5 WHERE EXISTS(SELECT 1 FROM farm_leases WHERE id=?1 AND tenant_id=?3 AND revision=?6 AND state='active')
   AND EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?3 AND revision=?7)
   AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?3 AND revision=?8)
   AND (?9=1 OR (EXISTS(SELECT 1 FROM users WHERE id=?3 AND disabled=0 AND kind='user') AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?3))) RETURNING lease_id`)
   .bind(lease.id,requestId,actor,attempt,t,lease.revision,row!.revision,row!.wallet_revision,type==='end'?1:0),
  // Assign state only at expiry, avoiding four unchanged status-index writes.
  db.prepare(`UPDATE farm_leases SET crop_state=?,revision=revision+1${type==='end'?",state='ended'":''} WHERE id=? AND ${gate}`).bind(nextPlot,lease.id,attempt),
  db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at) SELECT ?,'farm-lease-work',?,?,?,?,? WHERE ?<>0 AND ${gate}`)
   .bind(actor,lease.id+':'+requestId,attempt,delta,result.state.coins,t,delta,attempt),
  db.prepare(`UPDATE coin52_wallets SET balance=?,revision=revision+1,updated_at=? WHERE user_id=? AND ?<>0 AND ${gate}`).bind(result.state.coins,t,actor,delta,attempt),
  db.prepare(`UPDATE farm_saves SET state=?1,revision=revision+1,updated_at=?2${type==='end'?'':',owner_operated_at=?2'} WHERE user_id=?3 AND EXISTS(SELECT 1 FROM farm_lease_actions WHERE attempt=?4)`)
   .bind(encoded,t,actor,attempt),
  ...farmBadgeStatements(db,actor,encoded,row!.revision+1,t,original),
  ...marketStockStatements(db,{userId:actor,before:original,after:result.state,t,gate,bindings:[attempt]}),
 ]
 const saved=await db.batch(batch)
 if(!saved[0].results.length){if(await db.prepare('SELECT 1 FROM farm_lease_actions WHERE lease_id=? AND request_id=? AND actor_id=?').bind(lease.id,requestId,actor).first())return {duplicate:true};fail(409,'农场或租约刚刚发生变化，请刷新后重试')}
 return {duplicate:false,messages:result.messages}
}
export async function settleFarmLeases(db:D1Database,t:number,userId?:number){
 const query=userId===undefined?"SELECT * FROM farm_leases WHERE state='active' AND expires_at<=? ORDER BY expires_at LIMIT 12":"SELECT * FROM farm_leases WHERE state='active' AND expires_at<=? AND (owner_id=? OR tenant_id=?) ORDER BY expires_at LIMIT 24"
 const stmt=db.prepare(query),rows=await (userId===undefined?stmt.bind(t):stmt.bind(t,userId,userId)).all<Lease>()
 for(const lease of rows.results)await workLease(db,lease,lease.tenant_id,'expiry','end',null,false,t).catch(()=>console.error('farm_lease_settlement_retry',lease.id))
}
