import {communityCrops} from './community-species.ts'
import {projectRanch,applyRanchAction,type RanchState} from './ranch.ts'
import {themeCrops} from './theme-species.ts'
import {addStock,consumeStock,type StockOrigins} from './stock-origin.ts'
import {FARM_EXPANSIONS} from './capacity.ts'
import {projectLeisure,applyLeisureAction,PIGS,LEISURE_RULES,type FishingState,type PigState} from './leisure.ts'
import {consumeLegacy,type MarketSave} from './market-rules.ts'
import {guardianAction,GUARDIAN_RULES,protectedUntil,type GuardianState} from './guardian.ts'
import type {CareState} from './care.ts'
import {cropHasPests,cropMatureAt,cropSeconds,clearCropPests,waterCrop,type CropTiming} from '../shared/crop-care.ts'
export const FARM_VERSION=2
const ORIGINAL_CROPS=[
 {id:'carrot',name:'胡萝卜',seconds:60,seedPrice:3,sellPrice:7,xp:5,unlock:0,frame:4},
 {id:'cabbage',name:'包菜',seconds:120,seedPrice:5,sellPrice:11,xp:7,unlock:20,frame:5},
 {id:'wheat',name:'小麦',seconds:180,seedPrice:7,sellPrice:16,xp:9,unlock:60,frame:6},
 {id:'tomato',name:'番茄',seconds:240,seedPrice:10,sellPrice:22,xp:11,unlock:120,frame:7},
 {id:'corn',name:'玉米',seconds:360,seedPrice:13,sellPrice:30,xp:14,unlock:220,frame:8},
 {id:'pumpkin',name:'南瓜',seconds:600,seedPrice:18,sellPrice:45,xp:18,unlock:360,frame:9},
 {id:'jiba_banana',name:'几把巨蕉',seconds:3600,seedPrice:40,sellPrice:80,xp:25,unlock:100,frame:101},
 {id:'naizi_peach',name:'柰子蜜桃',seconds:7200,seedPrice:60,sellPrice:120,xp:30,unlock:180,frame:102},
 {id:'mole_mushroom',name:'魔了菇',seconds:14400,seedPrice:90,sellPrice:180,xp:40,unlock:280,frame:106},
 {id:'meme_sunflower',name:'梗图葵',seconds:28800,seedPrice:120,sellPrice:240,xp:50,unlock:380,frame:108},
 {id:'linux_pumpkin',name:'L站南瓜',seconds:43200,seedPrice:160,sellPrice:320,xp:65,unlock:480,frame:110},
 {id:'deepseek_rice',name:'DeepSeek鲸尾稻',seconds:10800,seedPrice:75,sellPrice:150,xp:35,unlock:220,frame:200},
 {id:'claude_wheat',name:'Claude暖穗',seconds:14400,seedPrice:90,sellPrice:180,xp:40,unlock:280,frame:201},
 {id:'gpt_cabbage',name:'GPT结绳菜',seconds:21600,seedPrice:105,sellPrice:210,xp:45,unlock:320,frame:202},
 {id:'gemini_berry',name:'Gemini双星莓',seconds:28800,seedPrice:120,sellPrice:240,xp:50,unlock:380,frame:203},
 {id:'qwen_cotton',name:'Qwen云棉',seconds:43200,seedPrice:150,sellPrice:300,xp:60,unlock:420,frame:204},
 {id:'kimi_bean',name:'Kimi月芽豆',seconds:21600,seedPrice:105,sellPrice:210,xp:45,unlock:320,frame:205},
 {id:'glm_bamboo',name:'GLM上下文竹',seconds:43200,seedPrice:160,sellPrice:320,xp:65,unlock:480,frame:206},
 {id:'grok_eggplant',name:'Grok夜茄',seconds:28800,seedPrice:120,sellPrice:240,xp:50,unlock:380,frame:207},
 {id:'jev_pepper',name:'Jev是非椒',seconds:7200,seedPrice:60,sellPrice:120,xp:30,unlock:180,frame:210},
] as const
export const BASE_CROPS=ORIGINAL_CROPS.map(c=>({...c,legacySeconds:c.seconds,seconds:Math.max(600,c.seconds)}))
export const CROPS=[...BASE_CROPS,...themeCrops(BASE_CROPS),...communityCrops(BASE_CROPS)] as const
export const TREE_KINDS={oak:{name:'橡树',hits:2,wood:3,seconds:180,frame:2},pine:{name:'松树',hits:3,wood:5,seconds:300,frame:3}} as const
export const EXPANSIONS=FARM_EXPANSIONS
type CropId=typeof CROPS[number]['id']
type Plot=CropTiming&{tilled:boolean;crop:CropId|null;plantedAt:number;stolen?:number;boosted?:boolean;leaseUntil?:number}
export type FarmState={version:1|2;coins:number;wood:number;xp:number;energy:number;energyAt:number;drinkAt:number;
 seeds:Record<CropId,number>;produce:Record<CropId,number>;plots:Plot[];
 trees:{kind:keyof typeof TREE_KINDS;hits:number;cutAt:number|null}[];
 discovery:Record<string,{firstAt:number;count:number}>;achievements:string[];totals:{harvest:number;wood:number;planted:number;watered?:number;pestsCleared?:number;stolen?:number;boosted?:boolean};
 receipts:{id:string;hash:string;revision:number}[];ranch?:RanchState;stockOrigins?:StockOrigins;guardUntil?:number;guardSoftUntil?:number;fishing?:FishingState;pigs?:PigState;market?:MarketSave;guardian?:GuardianState;care?:CareState}
export const ACHIEVEMENTS=[
 {id:'first_harvest',name:'第一篮收成',description:'累计收获2份作物',kind:'harvest',target:2,coins:10},
 {id:'woodworker',name:'林间来客',description:'累计采集12份木材',kind:'wood',target:12,coins:15},
 {id:'gardener',name:'勤劳园丁',description:'累计播种24次',kind:'planted',target:24,coins:30},
 {id:'harvester',name:'丰收日记',description:'累计收获100份作物',kind:'harvest',target:100,coins:60},
 {id:'naturalist',name:'田园博物家',description:'发现8种田园物产',kind:'discovery',target:8,coins:100},
] as const
const emptyPlot=():Plot=>({tilled:false,crop:null,plantedAt:0,wateredAt:null})
export function newFarm(t:number):FarmState{
 const seeds=Object.fromEntries(CROPS.map(c=>[c.id,c.id==='carrot'?6:0])) as Record<CropId,number>
 return {version:2,coins:40,wood:0,xp:0,energy:100,energyAt:t,drinkAt:0,seeds,
  produce:Object.fromEntries(CROPS.map(c=>[c.id,0])) as Record<CropId,number>,plots:Array.from({length:6},emptyPlot),
  trees:[],
  discovery:{},achievements:[],totals:{harvest:0,wood:0,planted:0},receipts:[]}
}
export function projectFarm(input:FarmState,t:number):FarmState{
 const s=structuredClone(input)
 if(s.version!==1&&s.version!==FARM_VERSION)throw Error('存档版本暂不支持，请刷新后重试')
 s.ranch=projectRanch(s.ranch,t)
 projectLeisure(s,t)
 for(const crop of CROPS){s.seeds[crop.id]??=0;s.produce[crop.id]??=0}
 // Legacy stamina and timber remain in old saves but no longer drive gameplay.
 return s
}
const requireCondition=(ok:unknown,message:string)=>{if(!ok)throw Error(message)}
function index(value:unknown,length:number){requireCondition(typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<length,'目标不存在');return value as number}
function count(value:unknown){requireCondition(typeof value==='number'&&Number.isInteger(value)&&value>0&&value<=99,'数量应为1至99的整数');return value as number}
function fields(a:Record<string,unknown>,allowed:string[]){requireCondition(Object.keys(a).every(k=>k==='type'||allowed.includes(k)),'操作包含不支持的字段')}
export function applyFarmActions(input:FarmState,actions:unknown,t:number,permissions:{allUnlocked?:boolean;lockedPlots?:number[];batchLimit?:number}={}):{state:FarmState;messages:string[]}{
 requireCondition(Number.isSafeInteger(t)&&t>0,'服务器时间无效')
 const batchLimit=Math.max(20,input.plots.length,(input.ranch?.animals.length??0)+(input.pigs?.animals.length??0),Math.min(240,permissions.batchLimit??0))
 requireCondition(Array.isArray(actions)&&actions.length>0&&actions.length<=batchLimit,`每批需要1至${batchLimit}个操作`)
 const s=projectFarm(input,t),messages:string[]=[]
 const discover=(id:string,n:number)=>{const old=s.discovery[id];s.discovery[id]={firstAt:old?.firstAt??t,count:(old?.count??0)+n}}
 for(const raw of actions as unknown[]){
  requireCondition(!!raw&&typeof raw==='object'&&!Array.isArray(raw),'操作格式无效')
  const a=raw as Record<string,unknown>
  if(['till','plant','water','harvest','uproot','pest'].includes(String(a.type))){
   fields(a,a.type==='plant'?['plot','crop','autoBuy']:['plot'])
   const p=s.plots[index(a.plot,s.plots.length)]
   if(a.type==='till'){
    requireCondition(!p.tilled,'这块地已经开垦');p.tilled=true;messages.push('土地已开垦')
   }else if(a.type==='plant'){
    requireCondition(p.tilled,'请先开垦这块地');requireCondition(!p.crop,'地里已经有作物')
    const crop=CROPS.find(c=>c.id===a.crop);requireCondition(crop,'未知作物');requireCondition(permissions.allUnlocked||s.xp>=crop!.unlock,'经验不足，尚未解锁这种作物')
    requireCondition(a.autoBuy===undefined||typeof a.autoBuy==='boolean','自动购买开关无效')
    if(a.autoBuy===true&&s.seeds[crop!.id]===0){requireCondition(s.coins>=crop!.seedPrice,'D币不足，未完成本批播种');s.coins-=crop!.seedPrice;s.seeds[crop!.id]++;messages.push('补买'+crop!.name+'种子 ×1')}
    requireCondition(s.seeds[crop!.id]>0,'种子不足，请到商店补充');s.seeds[crop!.id]--;p.crop=crop!.id;p.plantedAt=t;p.growSeconds=crop!.seconds;p.wateredAt=null;p.cycle=crypto.randomUUID();p.careCycle=1;delete p.pestAt;delete p.readyNotBefore;p.stolen=0;s.totals.planted++;messages.push(crop!.name+'已播种')
   }else if(a.type==='uproot'){
    requireCondition(p.crop,'地里还没有作物');const crop=CROPS.find(c=>c.id===p.crop)!
    p.crop=null;p.wateredAt=null;p.plantedAt=0;delete p.cycle;delete p.stolen;delete p.boosted;delete p.careCycle;delete p.pestAt;delete p.readyNotBefore;delete p.growSeconds;messages.push('已铲除'+crop.name+'，土地保留，种子不返还')
   }else if(a.type==='water'){
    requireCondition(p.crop,'地里还没有作物');requireCondition(p.wateredAt===null,'已经浇过水，安心等它长大');waterCrop(p,CROPS.find(c=>c.id===p.crop)!,t);s.totals.watered=(s.totals.watered??0)+1;messages.push('浇水完成，开始生长')
   }else if(a.type==='pest'){
    const crop=CROPS.find(c=>c.id===p.crop)
    requireCondition(crop&&cropHasPests(p,crop,t),'这里暂无需要处理的虫害');clearCropPests(p,crop!,t);s.totals.pestsCleared=(s.totals.pestsCleared??0)+1;messages.push('虫害已清除，恢复原生长进度')
   }else{
    requireCondition(p.crop,'地里还没有作物');requireCondition(p.wateredAt!==null,'请先浇水')
    const crop=CROPS.find(c=>c.id===p.crop)!;requireCondition(t>=cropMatureAt(p,crop),'作物还没有成熟')
    const yieldCount=2-Math.min(1,Math.max(0,p.stolen??0));s.produce[crop.id]+=yieldCount;addStock(s,'crop:'+crop.id,'grown',yieldCount);s.xp+=crop.xp;s.totals.harvest+=yieldCount;discover(crop.id,yieldCount);p.crop=null;p.wateredAt=null;p.plantedAt=0;delete p.cycle;delete p.stolen;delete p.boosted;delete p.careCycle;delete p.pestAt;delete p.readyNotBefore;delete p.growSeconds;messages.push('收获'+crop.name+' ×'+yieldCount)
   }
  }else if(a.type==='farm_item'){
   fields(a,a.item==='compost'?['item','plot']:['item']);const items=s.fishing?.items
   requireCondition(['compost','ward_charm','feed_bundle'].includes(String(a.item))&&items&&(items[String(a.item)]??0)>0,'道具不足')
   if(a.item==='compost'){
    const p=s.plots[index(a.plot,s.plots.length)],c=CROPS.find(c=>c.id===p.crop)
    requireCondition(c&&p.wateredAt!==null&&!p.boosted&&t<cropMatureAt(p,c!),'请选择尚未加速的生长中作物')
    p.wateredAt!-=Math.min(Math.floor(cropSeconds(p,c!)/10),cropMatureAt(p,c!)-t);p.boosted=true;messages.push('已施用水草堆肥，最多缩短原生长时间10%')
   }else if(a.item==='ward_charm'){
    requireCondition(protectedUntil(s)<=t,'守护仍在生效，不消耗巡田铃');s.guardSoftUntil=t+900;messages.push('巡田铃警戒15分钟：拦截普通摘取，潜入成功率降至40%')
   }else{requireCondition(s.ranch!.feed+6<=10000,'饲料仓已满');s.ranch!.feed+=6;messages.push('打开谷物包，牧场饲料 +6')}
   items![String(a.item)]--
  }else if(typeof a.type==='string'&&a.type.startsWith('guardian_')){
   if(a.type==='guardian_skill'&&a.skill==='care'){
    let cared=0
    for(const [i,p] of s.plots.entries()){
     if(cared>=GUARDIAN_RULES.maxCare)break
     if(permissions.lockedPlots?.includes(i))continue
     const c=CROPS.find(c=>c.id===p.crop);if(!c)continue
     if(p.wateredAt===null){waterCrop(p,c,t);cared++}else if(cropHasPests(p,c,t)){clearCropPests(p,c,t);cared++}
    }
    for(const [i,animal] of (s.ranch?.animals??[]).entries()){
     if(cared>=GUARDIAN_RULES.maxCare||!s.ranch?.feed)break
     if(!animal.deadAt&&animal.fedUntil<=t){applyRanchAction(s,{type:'animal_feed',animal:i,count:1},t,permissions);cared++}
    }
    for(const p of s.pigs?.animals??[]){
     if(cared>=GUARDIAN_RULES.maxCare||(s.ranch?.feed??0)<LEISURE_RULES.pigFeedUnits)break
     if(!p.deadAt&&p.fedUntil<=t){const spec=PIGS.find(c=>c.id===p.kind);if(spec&&p.growth<spec.seconds){applyLeisureAction(s,{type:'pig_feed_stock',pig:p.id,count:1},t,permissions.allUnlocked);cared++}}
    }
    for(const [i,a] of (s.ranch?.animals??[]).entries()){if(cared>=GUARDIAN_RULES.maxCare)break;if(a.manure){applyRanchAction(s,{type:'animal_clean',animal:i},t,permissions);cared++}}
    for(const p of s.pigs?.animals??[]){if(cared>=GUARDIAN_RULES.maxCare)break;if(p.manure){applyLeisureAction(s,{type:'pig_clean',pig:p.id},t,permissions.allUnlocked);cared++}}
    requireCondition(cared>0,'暂无需浇水、驱虫、添粮或清洁的目标，不消耗专注值')
    messages.push(guardianAction(s,a,t)+`，共${cared}处；添粮使用已有饲料`)
   }else messages.push(guardianAction(s,a,t))
  }else if(a.type==='guard'){
   fields(a,[]);requireCondition(protectedUntil(s)<=t,'守护仍在生效，无需重复购买');requireCondition(s.coins>=30,'守护需要30D币')
   s.coins-=30;s.guardSoftUntil=t+6*3600;messages.push('全园守护6小时：拦截普通摘取，潜入成功率降至40%')
  }else if(a.type==='boost'){
   fields(a,['plot']);const p=s.plots[index(a.plot,s.plots.length)],crop=CROPS.find(c=>c.id===p.crop)
   requireCondition(crop&&p.wateredAt!==null,'请选择已浇水的生长中作物');requireCondition(!p.boosted,'每茬作物只能加速一次')
   requireCondition(t<cropMatureAt(p,crop!),'作物已成熟，无需加速');const cost=Math.max(2,Math.ceil(crop!.seedPrice/4))
   requireCondition(s.coins>=cost,`加速需要${cost}D币`);s.coins-=cost;p.wateredAt!-=Math.min(Math.floor(cropSeconds(p,crop!)/4),cropMatureAt(p,crop!)-t);p.boosted=true
   messages.push(crop!.name+'已加速，最多缩短原生长时间的25%')
  }else if(a.type==='chop'||a.type==='drink'){
   throw Error('林地与体力机制已停用，请刷新农场')
  }else if(a.type==='buy'||a.type==='sell'||a.type==='seed_sell'){
   fields(a,a.type==='sell'?['crop','count','source']:['crop','count']);const crop=CROPS.find(c=>c.id===a.crop);requireCondition(crop,'未知作物');const n=count(a.count)
   if(a.type==='buy'){requireCondition(permissions.allUnlocked||s.xp>=crop!.unlock,'经验不足，尚未解锁这种作物');requireCondition(s.coins>=crop!.seedPrice*n,'D币不足');requireCondition(s.seeds[crop!.id]+n<=10000,'种子库存已满');s.coins-=crop!.seedPrice*n;s.seeds[crop!.id]+=n;messages.push('购入'+crop!.name+'种子 ×'+n)}
   else if(a.type==='seed_sell'){requireCondition(s.seeds[crop!.id]>=n,'种子数量不足');s.seeds[crop!.id]-=n;s.coins+=Math.floor(crop!.seedPrice/2)*n;messages.push('售出'+crop!.name+'种子 ×'+n)}
   else{requireCondition(s.produce[crop!.id]>=n,'收成数量不足');if(!consumeLegacy(s,'crop:'+crop!.id,n,a.source))consumeStock(s,'crop:'+crop!.id,s.produce[crop!.id],n,a.source);s.produce[crop!.id]-=n;s.coins+=crop!.sellPrice*n;messages.push('售出'+crop!.name+' ×'+n)}
  }else if(a.type==='expand'){
   fields(a,[]);const expansion=EXPANSIONS.find(x=>x.plots===s.plots.length);requireCondition(expansion,'全部土地已开放')
   const {coins,xp}=expansion!;requireCondition(permissions.allUnlocked||s.xp>=xp,`扩建需要达到${xp}经验`);requireCondition(s.coins>=coins,`扩建需要${coins}D币`);s.coins-=coins;s.plots.push(...Array.from({length:6},emptyPlot));messages.push('新增6块土地')
  }else if(['ranch_expand','animal_buy','feed_buy','animal_feed','animal_collect','animal_clean','animal_sell','animal_remove','product_sell'].includes(String(a.type))){messages.push(applyRanchAction(s,a,t,permissions))}
  else if(typeof a.type==='string'&&(a.type.startsWith('fish_')||a.type.startsWith('pig_')))messages.push(applyLeisureAction(s,a,t,permissions.allUnlocked))
  else throw Error('不支持的农场操作')
 }
 for(const goal of ACHIEVEMENTS){
  if(goal.id==='woodworker')continue
  const progress=goal.kind==='discovery'?[...CROPS.map(c=>c.id),...Object.keys(TREE_KINDS)].filter(id=>s.discovery[id]).length:s.totals[goal.kind]
  if(progress>=goal.target&&!s.achievements.includes(goal.id)){s.achievements.push(goal.id);s.coins+=goal.coins;messages.push('达成「'+goal.name+'」，🍌 +'+goal.coins)}
 }
 return {state:s,messages}
}
