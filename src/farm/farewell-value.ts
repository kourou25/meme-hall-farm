import {CROPS,projectFarm,type FarmState} from './rules'
import {ANIMALS,RANCH_RULES} from './ranch'
import {FISH,PIGS,LEISURE_RULES} from './leisure'
import {FISHING_RODS} from './fishing-catalog'
import {FARM_EXPANSIONS,RANCH_EXPANSIONS} from './capacity'
import {inventoryCounts,MARKET_ITEMS} from './market-stock'

export type FarewellLine={kind:string;label:string;quantity:number;cents:number}
export type FarewellLot={item:string;quantity:number;fresh:number}
export type FarewellLease={crop_state:string;price:number;started_at:number;expires_at:number}
const nonnegative=(n:number)=>{if(!Number.isSafeInteger(n)||n<0)throw Error('farm_farewell_invalid_amount');return n}
export function farewellValue(input:FarmState|null,t:number,prices:Record<string,number>,lots:FarewellLot[],leases:FarewellLease[],extras:{marketRemainder:number;conflictRefund:number}){
 const lines:FarewellLine[]=[]
 const add=(kind:string,label:string,quantity:number,cents:number)=>{nonnegative(quantity);nonnegative(cents);if(cents)lines.push({kind,label,quantity,cents})}
 const price=(key:string,base:number)=>nonnegative(prices[key]??base*100)
 if(input){
  const s=projectFarm(input,t),counts=inventoryCounts(s)
  for(const item of MARKET_ITEMS){
   const count=nonnegative(counts[item.key]??0);if(!count)continue
   const lot=lots.find(l=>l.item===item.key),tracked=Math.min(count,lot?.quantity??0),fresh=Math.min(tracked,lot?.fresh??0),untracked=count-tracked
   // farm_saves is the inventory total; lots only determine age. Never add both.
   const cents=(fresh+untracked)*price(item.key,item.price)+Math.floor((tracked-fresh)*price(item.key,item.price)/10)
   add('inventory',item.name,count,cents)
  }
  for(const crop of CROPS)add('seeds',crop.name+'种子',s.seeds[crop.id]??0,(s.seeds[crop.id]??0)*crop.seedPrice*100)
  for(const plot of s.plots){const crop=CROPS.find(c=>c.id===plot.crop);if(crop){const n=2-Math.min(1,Math.max(0,plot.stolen??0));add('growing',crop.name+'当期收成',n,n*price('crop:'+crop.id,crop.sellPrice))}}
  for(const animal of s.ranch?.animals??[]){
   const spec=ANIMALS.find(a=>a.id===animal.kind);if(!spec)throw Error('farm_farewell_unknown_animal')
   const n=animal.stored+(animal.deadAt===undefined?Math.max(0,Math.ceil((animal.fedUntil-animal.producedAt)/spec.seconds)):0)
   add('ranch',spec.product+'（含已投喂的未完成产出）',n,n*price('animal:'+spec.id,spec.sellPrice))
   if(animal.deadAt===undefined)add('animal',spec.name+'购入价返还',1,spec.price*100)
  }
  for(const pig of s.pigs?.animals??[]){const spec=PIGS.find(p=>p.id===pig.kind);if(spec&&!pig.deadAt)add('pig',spec.name+'成熟收益',1,spec.sellPrice*100)}
  add('feed','剩余饲料',s.ranch?.feed??0,(s.ranch?.feed??0)*RANCH_RULES.feedPrice*100)
  const avgFish=FISH.reduce((n,f)=>n+price('fish:'+f.id,f.price),0)/FISH.length
  if(s.fishing?.idle)add('fishing','挂机钓鱼完整预期收益',s.fishing.idle.count,Math.ceil(avgFish*s.fishing.idle.count))
  if(s.fishing?.cast&&s.fishing.cast.expires>=t){const n=('rods' in s.fishing.cast?s.fishing.cast.rods:1)??1;add('fishing','进行中抛竿费用返还',n,LEISURE_RULES.castCost*n*100)}
  const itemPrices:Record<string,number>={river_bait:4,strong_line:8,compost:10,ward_charm:20,feed_bundle:12,reed:3}
  for(const [id,n] of Object.entries(s.fishing?.items??{})){if(n&&!Object.hasOwn(itemPrices,id))throw Error('farm_farewell_unknown_item');add('tools',id,n,n*(itemPrices[id]??0)*100)}
  const rod=s.fishing?.gear?.rod??0;add('equipment','鱼竿升级投入返还',rod,FISHING_RODS.filter(r=>r.level<=rod).reduce((n,r)=>n+r.cost,0)*100)
  add('land','地块扩建投入返还',s.plots.length,FARM_EXPANSIONS.filter(e=>e.plots<s.plots.length).reduce((n,e)=>n+e.coins,0)*100)
  const slots=s.ranch?.slots??6;add('land','牧场扩建投入返还',slots,RANCH_EXPANSIONS.filter(e=>e.slots<slots).reduce((n,e)=>n+e.coins,0)*100)
 }
 for(const lease of leases){
  const plot=JSON.parse(lease.crop_state) as FarmState['plots'][number],crop=CROPS.find(c=>c.id===plot.crop)
  if(crop){const n=2-Math.min(1,Math.max(0,plot.stolen??0));add('lease','租地 · '+crop.name,n,n*price('crop:'+crop.id,crop.sellPrice))}
  if(lease.expires_at>t)add('rent','未使用租期返还',1,Math.ceil(lease.price*100*(lease.expires_at-t)/(lease.expires_at-lease.started_at)))
 }
 add('market','市场零钱',1,extras.marketRemainder)
 add('conflict','未完攻防投入返还',1,extras.conflictRefund*100)
 const totalCents=nonnegative(lines.reduce((n,x)=>n+x.cents,0))
 return {lines,total_cents:totalCents,coins:Math.ceil(totalCents/100)}
}
