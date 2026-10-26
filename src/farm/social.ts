import {cropMatureAt,cropProgress,waterCrop} from '../shared/crop-care.ts'
import {ANIMALS,RANCH_RULES,projectRanch,type RanchAnimal} from './ranch.ts'
import {CROPS,projectFarm,type FarmState} from './rules.ts'
import {addStock} from './stock-origin.ts'
import {protectedUntil,hardProtectionUntil} from './guardian.ts'
import {VISIT_RULES,visitFee} from './visit-rules.ts'
export const FARM_PROTECTION_SECONDS=5
export type VisitAction={type:'steal'|'water';plot:number;cycle:string}
export function cropSneakOffer(s:FarmState,p:FarmState['plots'][number],t:number){
 const c=CROPS.find(c=>c.id===p.crop)
 if(!c||!p.cycle||p.stolen||p.wateredAt===null||(p.leaseUntil??0)>t||hardProtectionUntil(s)>t||cropProgress(p,c,t)<VISIT_RULES.growth)return null
 const mature=cropMatureAt(p,c),early=t<mature,guarded=protectedUntil(s)>t
 if(!early&&(t<mature+FARM_PROTECTION_SECONDS||!guarded))return null
 return {fee:visitFee(c.sellPrice),chance:guarded?VISIT_RULES.guardedChance:VISIT_RULES.chance,early,guarded,name:c.name}
}
export function ranchSneakOffer(s:FarmState,a:RanchAnimal,t:number){
 const c=ANIMALS.find(c=>c.id===a.kind)
 if(!c||a.deadAt!==undefined||!a.id||hardProtectionUntil(s)>t||a.stolenEpoch===a.productionEpoch)return null
 const guarded=protectedUntil(s)>t,next=a.producedAt+c.seconds,early=a.stored<2
 if(early){if(a.stored<1||a.fedUntil<next||t<a.producedAt+c.seconds*VISIT_RULES.growth||t>=next)return null}
 else if(!guarded||t<(a.productionEpoch??t)+FARM_PROTECTION_SECONDS)return null
 return {fee:visitFee(c.sellPrice),chance:guarded?VISIT_RULES.guardedChance:VISIT_RULES.chance,early,guarded,name:c.product}
}
export function publicFarm(state:FarmState,t:number){
 const ranch=projectRanch(state.ranch,t),guarded=protectedUntil(state)>t
 return {guard_until:protectedUntil(state),hard_guard_until:hardProtectionUntil(state),visit_rules:VISIT_RULES,ranch:{animals:ranch.animals.map((a,index)=>({id:a.id,index,kind:a.kind,fedUntil:a.fedUntil,producedAt:a.producedAt,stored:a.stored,...a.deadAt!==undefined?{deadAt:a.deadAt}:{},cycle:`${a.id}:${a.productionEpoch}`,sneak:ranchSneakOffer(state,a,t),status:a.deadAt!==undefined?'dead':a.stored<2?'reserved':guarded?'guarded':t<(a.productionEpoch??t)+FARM_PROTECTION_SECONDS?'protected':a.stolenEpoch===a.productionEpoch?'reserved':'stealable'}))},plots:state.plots.map((p,index)=>{
  const crop=CROPS.find(c=>c.id===p.crop),matureAt=crop&&p.wateredAt!==null?cropMatureAt(p,crop):null
  const status=!crop?'empty':(p.leaseUntil??0)>t?'reserved':p.wateredAt===null?'dry':t<matureAt!?'growing':!p.cycle?'legacy':guarded?'guarded':t<matureAt!+FARM_PROTECTION_SECONDS?'protected':p.stolen?'reserved':'stealable'
  return {index,tilled:p.tilled,crop:p.crop,cycle:p.cycle??null,wateredAt:p.wateredAt,growSeconds:p.growSeconds,pestAt:p.pestAt,readyNotBefore:p.readyNotBefore,mature_at:matureAt,protected_until:matureAt===null?null:matureAt+FARM_PROTECTION_SECONDS,remaining:crop?2-(p.stolen??0):0,status,sneak:cropSneakOffer(state,p,t)}
 })}
}
export function applyFarmVisit(ownerInput:FarmState,visitorInput:FarmState,a:VisitAction,t:number,intrusion=false){
 const require=(ok:unknown,message:string)=>{if(!ok)throw Error(message)}
 require(Number.isSafeInteger(t)&&t>0,'服务器时间无效')
 require(a.type==='water'||a.type==='steal','不支持的互访操作')
 require(Number.isInteger(a.plot)&&a.plot>=0&&a.plot<ownerInput.plots.length,'目标不存在')
 // Mutations stay on the authoritative owner and visitor snapshots.
 const owner=structuredClone(ownerInput),visitor=projectFarm(visitorInput,t),p=owner.plots[a.plot]
 require(p.crop,'地里还没有作物');require(p.cycle,'旧作物保护中，本茬仅主人可操作')
 require(a.cycle===p.cycle,'这茬作物已更新，请刷新农场')
 const crop=CROPS.find(c=>c.id===p.crop)!
 if(a.type==='water'){require(p.wateredAt===null,'已经浇过水，无需重复操作');waterCrop(p,crop,t)}
 else{
  require((p.leaseUntil??0)<=t,'出租中地块不能摘取')
  if(intrusion)require(cropSneakOffer(owner,p,t),'目标未达到潜入条件或仍受旧守护保护')
  else{require(protectedUntil(owner)<=t,'农场守护生效中，暂不可摘取');require(p.wateredAt!==null&&t>=cropMatureAt(p,crop),'作物还没有成熟');require(t>=cropMatureAt(p,crop)+FARM_PROTECTION_SECONDS,'作物仍在成熟保护期')}
  require(!p.stolen,'剩余收成已为主人保留')
  require(visitor.produce[crop.id]<10000,'收成库存已满，请先整理背包')
  p.stolen=1;visitor.produce[crop.id]++;addStock(visitor,'crop:'+crop.id,'stolen',1)
  visitor.totals.stolen=Math.min(Number.MAX_SAFE_INTEGER,(visitor.totals.stolen||0)+1)
 }
 return {owner,visitor,crop:crop.id,amount:a.type==='steal'?1:0,message:a.type==='steal'?`摘取${crop.name} ×1，已放入背包`:`已帮忙浇水，${crop.name}开始生长`}
}

export type RanchVisitAction={type:'animal_steal';animal_id:string;cycle:string}
export function applyRanchVisit(ownerInput:FarmState,visitorInput:FarmState,a:RanchVisitAction,t:number,intrusion=false){
 const require=(ok:unknown,message:string)=>{if(!ok)throw Error(message)}
 require(Number.isSafeInteger(t)&&t>0,'服务器时间无效')
 const owner=projectFarm(ownerInput,t),visitor=projectFarm(visitorInput,t),ranch=owner.ranch!,index=ranch.animals.findIndex(x=>x.id===a.animal_id),animal=ranch.animals[index]
 require(a.type==='animal_steal'&&animal,'动物已变化，请刷新牧场')
 require(a.cycle===`${animal.id}:${animal.productionEpoch}`,'产出已更新，请刷新牧场')
 require(animal.deadAt===undefined,'这只动物已死亡，已有畜产仅主人可收取')
 const offer=intrusion?ranchSneakOffer(owner,animal,t):null
 if(intrusion)require(offer,'目标未达到潜入条件或仍受旧守护保护')
 else{require(protectedUntil(owner)<=t,'牧场守护生效中，暂不可摘取');require(animal.stored>=2,'至少为主人保留一份畜产');require(t>=(animal.productionEpoch??t)+FARM_PROTECTION_SECONDS,'畜产仍在保护期')}
 require(animal.stolenEpoch!==animal.productionEpoch,'本轮产出已被摘取，等待新的产出')
 const spec=ANIMALS.find(x=>x.id===animal.kind)!,inventory=visitor.ranch!.products
 require((inventory[spec.id]??0)<10000,'畜产仓已满')
 // 提前摘取预支下一轮：生产时钟推进一轮，现有存货保留，不能再次投影出同一份。
 if(offer?.early){animal.producedAt+=spec.seconds;animal.productionEpoch=animal.producedAt}else animal.stored--
 animal.stolenEpoch=animal.productionEpoch;inventory[spec.id]=(inventory[spec.id]??0)+1;addStock(visitor,'animal:'+spec.id,'stolen',1)
 visitor.totals.stolen=Math.min(Number.MAX_SAFE_INTEGER,(visitor.totals.stolen||0)+1)
 return {owner,visitor,index,crop:spec.id,amount:1,message:`摘取${spec.product} ×1，已放入背包`}
}
