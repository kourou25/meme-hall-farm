import {themeAnimals} from './theme-species.ts'
import {addStock,consumeStock,type StockOrigins} from './stock-origin.ts'
import {RANCH_EXPANSIONS} from './capacity.ts'
import {consumeLegacy,type MarketSave} from './market-rules.ts'
import {compostManure,type CareState} from './care.ts'
const ORIGINAL_ANIMALS=[
 {id:'chicken',name:'团团鸡',product:'鸡蛋',price:80,sellPrice:6,seconds:600,xp:2,unlock:0,frame:6},
 {id:'cow',name:'奶糖牛',product:'鲜奶',price:160,sellPrice:14,seconds:3600,xp:5,unlock:80,frame:7},
 {id:'sheep',name:'云朵羊',product:'羊毛',price:200,sellPrice:22,seconds:7200,xp:7,unlock:200,frame:8},
 {id:'huan_cat',name:'欢欢猫',product:'欢欢猫毛球',price:120,sellPrice:10,seconds:1800,xp:3,unlock:100,frame:100},
 {id:'gentle_swan',name:'正人君子鹅',product:'君子羽',price:240,sellPrice:24,seconds:7200,xp:7,unlock:240,frame:103},
 {id:'turbo_bull',name:'有挂牛',product:'闪电奶',price:280,sellPrice:12,seconds:1800,xp:3,unlock:300,frame:104},
 {id:'holy_deer',name:'神了鹿',product:'星光绒',price:400,sellPrice:38,seconds:14400,xp:10,unlock:500,frame:105},
 {id:'meme_chicken',name:'meme团子鸡',product:'迷因蛋',price:180,sellPrice:9,seconds:1200,xp:3,unlock:180,frame:107},
 {id:'nsfw_sheep',name:'NSFW夜绒羊',product:'夜绒',price:320,sellPrice:32,seconds:10800,xp:9,unlock:400,frame:109},
 {id:'linux_sheep',name:'L站欢聚羊',product:'欢聚绒',price:360,sellPrice:35,seconds:14400,xp:10,unlock:450,frame:111},
 {id:'llama',name:'Llama绒驼',product:'绒驼毛',price:300,sellPrice:30,seconds:10800,xp:8,unlock:360,frame:209},
] as const
// More room for idle play: double the net return after feed, then add a small
// long-cycle premium. Purchase cost and production clocks stay stable.
export const BASE_ANIMALS=ORIGINAL_ANIMALS.map(a=>({...a,legacySellPrice:a.sellPrice,sellPrice:2+(a.sellPrice-2)*2+Math.ceil(a.seconds/3600*4)}))
export const ANIMALS=[...BASE_ANIMALS,...themeAnimals(BASE_ANIMALS)] as const
export type AnimalId=typeof ANIMALS[number]['id']
export type RanchAnimal={id?:string;productionEpoch?:number;stolenEpoch?:number;kind:AnimalId;fedUntil:number;producedAt:number;stored:number;deadAt?:number;manure?:number}
export type RanchState={slots?:number;animals:RanchAnimal[];feed:number;products:Record<string,number>;discovery:Record<string,{firstAt:number;count:number}>;collected:number}
export const RANCH_RULES={slots:6,maxSlots:24,expansions:RANCH_EXPANSIONS,capacity:12,feedPrice:2,maxFedSeconds:86400,maxFeed:10000,starvationSeconds:48*3600}
export const newRanch=():RanchState=>({animals:[],feed:0,products:{},discovery:{},collected:0})
export function projectRanch(input:RanchState|undefined,t:number):RanchState{
 const r=input?structuredClone(input):newRanch()
 r.slots??=6
 for(const [index,a] of r.animals.entries()){
  a.id??=`legacy-${index}-${a.kind}-${a.fedUntil}`
  a.productionEpoch??=a.producedAt
  const spec=ANIMALS.find(x=>x.id===a.kind);if(!spec)throw Error('牧场物种暂不支持，请刷新页面')
  if(a.deadAt!==undefined)continue
  const elapsed=Math.max(0,Math.floor((Math.min(t,a.fedUntil)-a.producedAt)/spec.seconds))
  const added=Math.min(RANCH_RULES.capacity-a.stored,elapsed)
  // Old save normalization starts clean; never invent historic manure.
  a.manure=a.manure===undefined?0:Math.min(12,a.manure+added)
  if(added>0)a.productionEpoch=a.producedAt+added*spec.seconds
  a.stored+=added
  a.producedAt+=elapsed*spec.seconds
  const deadline=a.fedUntil+RANCH_RULES.starvationSeconds
  if(t>=deadline)a.deadAt=deadline
 }
 return r
}
export function applyRanchAction(s:{coins:number;xp:number;energy:number;ranch?:RanchState;stockOrigins?:StockOrigins;market?:MarketSave;care?:CareState;fishing?:{items?:Record<string,number>}},a:Record<string,unknown>,t:number,permissions:{allUnlocked?:boolean}={}):string{
 const r=s.ranch=projectRanch(s.ranch,t)
 const require=(ok:unknown,message:string)=>{if(!ok)throw Error(message)}
 const fields=(keys:string[])=>require(Object.keys(a).every(k=>k==='type'||keys.includes(k)),'操作包含不支持的字段')
 const count=()=>{require(Number.isSafeInteger(a.count)&&Number(a.count)>0&&Number(a.count)<=99,'数量应为1至99的整数');return Number(a.count)}
 if(a.type==='ranch_expand'){
  fields([]);const expansion=RANCH_EXPANSIONS.find(x=>x.slots===r.slots);require(expansion,'牧场栏位已全部开放');require(permissions.allUnlocked||s.xp>=expansion!.xp,`扩建需要达到${expansion!.xp}经验`);require(s.coins>=expansion!.coins,'D币不足');s.coins-=expansion!.coins;r.slots!+=6;return '新增6个牧场栏位'
 }
 if(a.type==='animal_buy'){
  fields(['kind','count']);const n=a.count===undefined?1:count(),spec=ANIMALS.find(x=>x.id===a.kind);require(spec,'未知动物');require(permissions.allUnlocked||s.xp>=spec!.unlock,'经验不足，尚未解锁这种动物');require(r.animals.length+n<=r.slots!,`牧场空栏位不足，当前可饲养${r.slots}只动物，可在扩建中增加栏位`);require(s.coins>=spec!.price*n,'D币不足')
  s.coins-=spec!.price*n;for(let i=0;i<n;i++)r.animals.push({id:crypto.randomUUID(),productionEpoch:t,kind:spec!.id,fedUntil:t,producedAt:t,stored:0,manure:0});return '迎来'+spec!.name+' ×'+n
 }
 if(a.type==='feed_buy'){
  fields(['count']);const n=count();require(r.feed+n<=RANCH_RULES.maxFeed,'饲料仓已满');require(s.coins>=n*RANCH_RULES.feedPrice,'D币不足');s.coins-=n*RANCH_RULES.feedPrice;r.feed+=n;return '购入饲料 ×'+n
 }
 if(a.type==='product_sell'){
  fields(['kind','count','source']);const spec=ANIMALS.find(x=>x.id===a.kind),n=count();require(spec,'未知畜产');require((r.products[spec!.id]??0)>=n,'畜产数量不足');if(!consumeLegacy(s,'animal:'+spec!.id,n,a.source))consumeStock(s,'animal:'+spec!.id,r.products[spec!.id],n,a.source);r.products[spec!.id]-=n;s.coins+=n*spec!.sellPrice;return '售出'+spec!.product+' ×'+n
 }
 fields(a.type==='animal_feed'?['animal','count','autoBuy']:a.type==='animal_remove'?['animal','collect']:['animal'])
 require(Number.isInteger(a.animal)&&Number(a.animal)>=0&&Number(a.animal)<r.animals.length,'动物不存在')
 const animal=r.animals[Number(a.animal)],spec=ANIMALS.find(x=>x.id===animal.kind)!
 const collect=()=>{
  const n=animal.stored;require(n>0,'暂时没有可收取的畜产');require((r.products[spec.id]??0)+n<=10000,'畜产仓已满，请先出售')
  animal.stored=0;r.products[spec.id]=(r.products[spec.id]??0)+n;addStock(s,'animal:'+spec.id,'grown',n);r.collected+=n;s.xp+=spec.xp*n
  const d=r.discovery[spec.id];r.discovery[spec.id]={firstAt:d?.firstAt??t,count:(d?.count??0)+n};return n
 }
 if(a.type==='animal_clean'){const message=compostManure(s,animal.manure??0);animal.manure=0;return message}
 if(a.type==='animal_remove'){
  require(animal.deadAt!==undefined,'存活动物不能清理');require(a.collect===undefined||typeof a.collect==='boolean','收取开关无效')
  const saved=a.collect===true&&animal.stored>0?collect():0
  require(animal.stored===0,'请先收取已有畜产');r.animals.splice(Number(a.animal),1);return '已清理'+spec.name+'的栏位'+(saved?`，${spec.product} ×${saved} 已入仓`:'')
 }
 if(a.type==='animal_feed'||a.type==='animal_sell')require(animal.deadAt===undefined,'动物已死亡，不能喂养或出售，请清理栏位')
 if(a.type==='animal_feed'){
  const n=count();require(a.autoBuy===undefined||typeof a.autoBuy==='boolean','补粮开关无效');const start=Math.max(t,animal.fedUntil)
  require(start+n*spec.seconds<=t+RANCH_RULES.maxFedSeconds,'每只动物最多预备24小时饲料')
  const missing=Math.max(0,n-r.feed)
  if(a.autoBuy===true&&missing){require(s.coins>=missing*RANCH_RULES.feedPrice,'D币不足，本批补粮未完成');s.coins-=missing*RANCH_RULES.feedPrice;r.feed+=missing}
  require(r.feed>=n,'饲料不足，请先补充')
  if(animal.fedUntil<=t)animal.producedAt=t
  animal.fedUntil=start+n*spec.seconds;r.feed-=n;return spec.name+'添粮，备好'+n+'轮产出'
 }
 if(a.type==='animal_collect'){
  return '收取'+spec.product+' ×'+collect()
 }
 if(a.type==='animal_sell'){
  require(animal.stored===0,'请先收取这只动物的畜产');r.animals.splice(Number(a.animal),1);const refund=Math.floor(spec.price/2);s.coins+=refund;return '送别'+spec.name+'，返还'+refund+' D币'
 }
 throw Error('不支持的牧场操作')
}
