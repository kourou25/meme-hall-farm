import {applyFarmActions,CROPS,type FarmState} from './rules'
import {cropMaxSeconds} from '../shared/crop-care'
export type SceneLease={id:string;plot:number;owner_id:number;owner_name:string;expires_at:number;crop_state:string;revision:number}
export async function farmLeaseScene(db:D1Database,uid:number,t:number){
 const [owned,rented]=await db.batch([
  db.prepare(`SELECT l.plot,l.expires_at,l.crop_state,u.username AS tenant_name FROM farm_leases l JOIN users u ON u.id=l.tenant_id WHERE l.owner_id=? AND l.state='active' AND l.expires_at>?`).bind(uid,t),
  db.prepare(`SELECT l.id,l.plot,l.owner_id,u.username AS owner_name,l.expires_at,l.crop_state,l.revision FROM farm_leases l JOIN users u ON u.id=l.owner_id WHERE l.tenant_id=? AND l.state='active' AND l.expires_at>? ORDER BY l.started_at,l.id`).bind(uid,t),
 ])
 return {locks:owned.results as {plot:number;expires_at:number;crop_state:string;tenant_name:string}[],rented:rented.results as SceneLease[]}
}
export function leaseSceneView<T extends {state:{plots:FarmState['plots']}}>(view:T,scene:Awaited<ReturnType<typeof farmLeaseScene>>){
 for(const lock of scene.locks){const p=view.state.plots[lock.plot];if(p)Object.assign(p,{leaseUntil:lock.expires_at,leaseTenant:lock.tenant_name,leaseCrop:JSON.parse(lock.crop_state)})}
 return {...view,rentedPlots:scene.rented.map(l=>({...l,crop_state:JSON.parse(l.crop_state)}))}
}
// Virtual plot indices exist only during calculation. Only the original plots
// return to farm_saves; leased crops are committed alongside that revision.
export function applyFarmSceneActions(input:FarmState,actions:Record<string,unknown>[],rented:SceneLease[],t:number,permissions:{allUnlocked?:boolean;lockedPlots:number[]}){
 const changed=new Map<string,{lease:SceneLease;index:number}>(),plots=[...input.plots],mapped:Record<string,unknown>[]=[]
 const ownTypes=['till','plant','water','pest','harvest'],hasLeases=actions.some(a=>String(a?.type).startsWith('lease_'))
 if(!hasLeases)return {...applyFarmActions(input,actions,t,permissions),leases:[] as SceneLease[]}
 for(const a of actions){
  if(!a||typeof a!=='object')throw Error('操作格式无效')
  if(!String(a.type).startsWith('lease_')){
   if(!ownTypes.includes(String(a.type))||!Number.isInteger(a.plot)||Number(a.plot)<0||Number(a.plot)>=input.plots.length)throw Error('租地照料不能混用其他操作或地块编号')
   if(permissions.lockedPlots.includes(Number(a.plot)))throw Error('这块田地已出租，暂时不能操作')
   mapped.push(a);continue
  }
  const type=String(a.type).slice(6),allowed=type==='plant'?['type','leaseId','crop','autoBuy']:['type','leaseId']
  if(!['plant','pest','harvest'].includes(type)||Object.keys(a).some(k=>!allowed.includes(k)))throw Error('租地操作格式无效')
  const lease=rented.find(l=>l.id===a.leaseId)
  if(!lease||lease.expires_at<=t)throw Error('租约已到期或不属于你，请刷新农场')
  if(type==='plant'){const c=CROPS.find(c=>c.id===a.crop);if(!c||t+cropMaxSeconds(c.seconds)>lease.expires_at)throw Error('租期不足以覆盖成熟及虫害缓冲，请选择生长更快的种子')}
  if(!changed.has(lease.id)){changed.set(lease.id,{lease,index:plots.length});plots.push(JSON.parse(lease.crop_state))}
  const plot=changed.get(lease.id)!.index
  mapped.push({type,plot,...type==='plant'?{crop:a.crop,autoBuy:a.autoBuy}:{}})
  if(type==='plant')mapped.push({type:'water',plot})
 }
 const result=applyFarmActions({...input,plots},mapped,t,{...permissions,batchLimit:240})
 const leases=[...changed.values()].map(({lease,index})=>({...lease,crop_state:JSON.stringify(result.state.plots[index]),revision:lease.revision+1}))
 result.state.plots=result.state.plots.slice(0,input.plots.length)
 return {...result,leases}
}
