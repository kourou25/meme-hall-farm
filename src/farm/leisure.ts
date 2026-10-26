// Authoritative leisure state shares the farm revision, receipt and wallet transaction.
import {consumeLegacy,type MarketSave} from './market-rules.ts'
import {FISH} from './fishing-catalog.ts'
import {fishingV3Action,type FishingCastV3,type FishingV3Progress} from './fishing-v3.ts'
import {compostManure,type CareState} from './care.ts'
import {RANCH_RULES} from './ranch.ts'
export {FISH} from './fishing-catalog.ts'
export const PIGS=[
 {id:'dumpling',name:'团子猪',seconds:14400,price:80,sellPrice:120,xp:12,unlock:0,color:'#e5acac'},
 {id:'huan',name:'欢欢桃桃猪',seconds:14400,price:80,sellPrice:120,xp:12,unlock:0,color:'#d992a8'},
 {id:'banana',name:'巨蕉布丁猪',seconds:28800,price:140,sellPrice:210,xp:20,unlock:100,color:'#dac17b'},
 {id:'linux',name:'L站黑白猪',seconds:28800,price:140,sellPrice:210,xp:20,unlock:100,color:'#a6acb2'},
 {id:'holy',name:'神了金铃猪',seconds:43200,price:200,sellPrice:300,xp:30,unlock:300,color:'#d6af66'},
 {id:'mole',name:'魔了夜绒猪',seconds:43200,price:200,sellPrice:300,xp:30,unlock:300,color:'#ac8fac'},
]
export const LEISURE_RULES={castCost:2,biteWindow:12,reelSeconds:2,reelWindow:6,idleHours:[2,4,8],idleInterval:600,fishCapacity:1000,pigSlots:6,feedPrice:4,pigFeedUnits:2,feedSeconds:7200,maxFeedSeconds:86400,starvationSeconds:172800}
export type FishingState=FishingV3Progress&{basket:Record<string,number>;discovery:Record<string,number>;caught:number;cast?:FishingCastV3|{v?:undefined;started:number;biteAt:number;expires:number;reelAt?:number};idle?:{started:number;ends:number;count:number};lastCatch?:{at:number;items:Record<string,number>}}
export type Pig={id:string;kind:string;growth:number;fedUntil:number;updatedAt:number;deadAt?:number;manure?:number;manureSeconds?:number}
export type PigState={animals:Pig[];raised:number;discovery:Record<string,number>}
type State={ranch?:{feed:number};coins:number;xp:number;seeds?:Record<string,number>;produce?:Record<string,number>;fishing?:FishingState;pigs?:PigState;market?:MarketSave;care?:CareState}
const ensure=(ok:unknown,message:string)=>{if(!ok)throw Error(message)}
function fields(a:Record<string,unknown>,allowed:string[]){ensure(Object.keys(a).every(k=>k==='type'||allowed.includes(k)),'操作包含不支持的字段')}
function count(n:unknown,max=99){ensure(typeof n==='number'&&Number.isInteger(n)&&n>0&&n<=max,`数量应为1至${max}的整数`);return n as number}
function random(n:number){const v=new Uint32Array(1),limit=Math.floor(4294967296/n)*n;do{crypto.getRandomValues(v)}while(v[0]>=limit);return v[0]%n}
export function projectLeisure(s:State,t:number){
 s.fishing??={basket:{},discovery:{},caught:0};s.pigs??={animals:[],raised:0,discovery:{}}
 for(const p of s.pigs.animals){
  if(p.deadAt)continue
  const spec=PIGS.find(c=>c.id===p.kind);if(!spec)continue
  const grown=Math.max(0,Math.min(spec.seconds-p.growth,Math.min(t,p.fedUntil)-p.updatedAt))
  if(p.manure===undefined){p.manure=0;p.manureSeconds=0}else{const seconds=(p.manureSeconds??0)+grown;p.manure=Math.min(12,p.manure+Math.floor(seconds/7200));p.manureSeconds=seconds%7200}
  p.growth=Math.min(spec.seconds,p.growth+grown);p.updatedAt=t
  if(t>=p.fedUntil+LEISURE_RULES.starvationSeconds)p.deadAt=p.fedUntil+LEISURE_RULES.starvationSeconds
 }
}
export function applyLeisureAction(s:State,a:Record<string,unknown>,t:number,allUnlocked=false){
 projectLeisure(s,t);const f=s.fishing!,p=s.pigs!,r=LEISURE_RULES
 if(String(a.type).startsWith('fish_')){const message=fishingV3Action(s,a,t);if(message!==null)return message}
 const pay=(n:number)=>{ensure(s.coins>=n,'D币余额不足');s.coins-=n}
 const catchFish=(n:number)=>{
  // Reserve worst-case capacity before drawing: retries cannot reroll a full basket.
  ensure(FISH.every(c=>(f.basket[c.id]??0)+n<=r.fishCapacity),'鱼篓空间不足，请先出售鱼获')
  const items:Record<string,number>={};for(let i=0;i<n;i++){const c=FISH[random(FISH.length)];items[c.id]=(items[c.id]??0)+1;f.basket[c.id]=(f.basket[c.id]??0)+1;f.discovery[c.id]=(f.discovery[c.id]??0)+1}f.caught+=n;f.lastCatch={at:t,items};s.xp+=n;return items
 }
 if(a.type==='fish_reel'){
  fields(a,[]);ensure(f.cast&&!f.cast.reelAt&&t>=f.cast.biteAt&&t<=f.cast.expires,'当前不能收线，请在咬钩时操作');f.cast!.reelAt=t;f.cast!.expires=t+r.reelWindow;return '鱼儿上钩，按住收线'
 }
 if(a.type==='fish_catch'){
  fields(a,[]);ensure(f.cast?.reelAt&&t>=f.cast.reelAt+r.reelSeconds&&t<=f.cast.expires,'收线时间未满足或鱼儿已脱钩');const items=catchFish(1);delete f.cast;return '钓到'+FISH.find(c=>items[c.id])!.name+'，已放入鱼篓'
 }
 if(a.type==='fish_idle'){
  fields(a,['hours']);ensure(r.idleHours.includes(a.hours as number),'挂机只能选择2、4或8小时');ensure(!f.idle&&(!f.cast||t>f.cast.expires),'请先结束当前钓鱼');const n=Number(a.hours)*3600/r.idleInterval;ensure(FISH.every(c=>(f.basket[c.id]??0)+n<=r.fishCapacity),'鱼篓空间不足，请先出售');pay(n*r.castCost);delete f.cast;f.idle={started:t,ends:t+Number(a.hours)*3600,count:n};return '挂机已开始，离线继续钓鱼'
 }
 if(a.type==='fish_idle_claim'){
  fields(a,[]);ensure(f.idle,'没有进行中的挂机');const n=Math.min(f.idle!.count,Math.floor((t-f.idle!.started)/r.idleInterval));ensure(n>=1,'至少完成10分钟才能收取');catchFish(n);delete f.idle;return `挂机结束，鱼篓新增${n}条；未用鱼饵不退款`
 }
 if(a.type==='fish_sell'){
  fields(a,['fish','count']);const c=FISH.find(x=>x.id===a.fish),n=count(a.count);ensure(c,'未知鱼种');ensure((f.basket[c!.id]??0)>=n,'鱼获数量不足');consumeLegacy(s,'fish:'+c!.id,n);f.basket[c!.id]-=n;s.coins+=c!.price*n;return `售出${c!.name} ×${n}`
 }
 if(a.type==='pig_buy'){
  fields(a,['kind','count']);const c=PIGS.find(x=>x.id===a.kind),n=count(a.count,r.pigSlots);ensure(c,'未知猪种');ensure(allUnlocked||s.xp>=c!.unlock,'经验不足，尚未解锁');ensure(p.animals.length+n<=r.pigSlots,'猪栏不足，请先出售成年猪或清理死亡栏位');pay(c!.price*n)
  for(let i=0;i<n;i++)p.animals.push({id:crypto.randomUUID(),kind:c!.id,growth:0,fedUntil:t+r.feedSeconds,updatedAt:t,manure:0,manureSeconds:0});return `购入${c!.name}猪仔 ×${n}，已带2小时饲料`
 }
 if(['pig_feed','pig_feed_stock','pig_sell','pig_remove','pig_clean'].includes(String(a.type))){
  fields(a,a.type==='pig_feed_stock'?['pig','count','autoBuy']:a.type==='pig_feed'?['pig','count']:['pig']);const pig=p.animals.find(x=>x.id===a.pig);ensure(pig,'猪栏已变化，请刷新');const c=PIGS.find(x=>x.id===pig!.kind)!
  if(a.type==='pig_clean'){const message=compostManure(s,pig!.manure??0);pig!.manure=0;return message}
  if(a.type==='pig_remove'){ensure(pig!.deadAt,'只能清理已死亡的猪');p.animals=p.animals.filter(x=>x!==pig);return '已清理猪栏'}
  ensure(!pig!.deadAt,'连续缺粮48小时已死亡，请清理猪栏')
  if(a.type==='pig_feed'||a.type==='pig_feed_stock'){
   const n=count(a.count,12),until=Math.max(t,pig!.fedUntil)+n*r.feedSeconds;ensure(until-t<=r.maxFeedSeconds,'最多储备24小时饲料')
   if(a.type==='pig_feed_stock'){
    ensure(a.autoBuy===undefined||typeof a.autoBuy==='boolean','补粮开关无效');ensure(s.ranch,'请先加载牧场')
    const missing=Math.max(0,n*r.pigFeedUnits-s.ranch!.feed)
    if(a.autoBuy===true&&missing){pay(missing*RANCH_RULES.feedPrice);s.ranch!.feed+=missing}
    ensure(s.ranch!.feed>=n*r.pigFeedUnits,'饲料库存不足');s.ranch!.feed-=n*r.pigFeedUnits
   }else pay(n*r.feedPrice)
   pig!.fedUntil=until;return `已添粮，增加${n*2}小时饲料`
  }
  ensure(pig!.growth>=c.seconds,'猪仔尚未长成');s.coins+=c.sellPrice;s.xp+=c.xp;p.raised++;p.discovery[c.id]=(p.discovery[c.id]??0)+1;p.animals=p.animals.filter(x=>x!==pig);return `售出成年${c.name}`
 }
 throw Error('不支持的钓鱼或猪场操作')
}
