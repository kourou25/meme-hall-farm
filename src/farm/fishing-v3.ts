import {fishingFrame,validateFishingMoves,type FishingFight} from '../shared/fishing-game.ts'
import {FISH,FISHING_ITEMS,FISHING_RODS} from './fishing-catalog.ts'
import {addStock,type StockOrigins} from './stock-origin.ts'
export type FishingCastV3={v:3;id:string;rods?:number;_secret?:number;rod:number;line:boolean;bait:boolean;point:{x:number;y:number};pattern:number[];started:number;biteAt:number;expires:number;reelAt?:number}
export type FishingOutcome={id:string;at:number;ok:boolean;label:string;kind:string;item?:string;count?:number}
export type FishingV3Progress={gear?:{rod:number};items?:Record<string,number>;landed?:number;escaped?:number;treasures?:number;lastOutcomes?:FishingOutcome[];lastOutcome?:FishingOutcome}
type State={coins:number;xp:number;seeds?:Record<string,number>;produce?:Record<string,number>;stockOrigins?:StockOrigins;fishing?:FishingV3Progress&{basket:Record<string,number>;discovery:Record<string,number>;caught:number;cast?:any;idle?:unknown;lastCatch?:{at:number;items:Record<string,number>}}}
const require=(ok:unknown,message:string)=>{if(!ok)throw Error(message)}
const random=(max:number)=>{const x=new Uint32Array(1),limit=Math.floor(4294967296/max)*max;do{crypto.getRandomValues(x)}while(x[0]>=limit);return x[0]%max}
function roll(seed:number,salt:number,max:number){let x=(seed^salt)>>>0;x=Math.imul(x^(x>>>16),0x7feb352d);x=Math.imul(x^(x>>>15),0x846ca68b);return ((x^(x>>>16))>>>0)%max}
function fields(a:Record<string,unknown>,keys:string[]){require(Object.keys(a).every(k=>k==='type'||keys.includes(k)),'操作包含不支持的字段')}
export function fishingV3Action(s:State,a:Record<string,unknown>,t:number):string|null{
 const f=s.fishing!;f.items??={};f.gear??={rod:0}
 if(a.type==='fish_rod_upgrade'){
  fields(a,[]);require(!f.cast||t>f.cast.expires,'请先完成这一竿');const next=FISHING_RODS[f.gear.rod+1];require(next,'鱼竿已满级');require(s.coins>=next.cost,'D币不足');s.coins-=next.cost;f.gear.rod=next.level;return '鱼竿升级为'+next.name
 }
 if(a.type==='fish_craft_line'){
  fields(a,[]);require((f.items.reed??0)>=3,'编线需要3份柔韧芦苇');require((f.items.strong_line??0)<9999,'韧丝线已满');f.items.reed-=3;f.items.strong_line=(f.items.strong_line??0)+1;return '编成韧丝线 ×1'
 }
 if(a.type==='fish_cast'){
  fields(a,['point','bait','line','rods']);const rods=a.rods===undefined?1:Number(a.rods);require(typeof a.rods==='undefined'||typeof a.rods==='number','鱼竿数量无效');require([1,3,5].includes(rods),'请选择1、3或5杆');require(!f.idle,'请先结束挂机');require(!f.cast||t>f.cast.expires,'这一竿尚未结束')
  require(a.bait===undefined||typeof a.bait==='boolean','鱼饵选项无效');require(a.line===undefined||typeof a.line==='boolean','鱼线选项无效')
  const p=(a.point??{x:.54,y:.48}) as Record<string,unknown>;require(p&&typeof p==='object'&&Object.keys(p).every(k=>['x','y'].includes(k))&&typeof p.x==='number'&&typeof p.y==='number'&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x-.5)+Math.abs(p.y-.5)<=.8,'落点不在水面内')
  require(s.coins>=2*rods,`本次${rods}杆需要${2*rods}枚D币`);if(a.bait)require((f.items.river_bait??0)>=rods,'溪虫饵不足，每杆消耗1份');if(a.line)require((f.items.strong_line??0)>=rods,'韧丝线不足，每杆消耗1份')
  if(f.cast){f.escaped=(f.escaped??0)+(f.cast.rods??1);f.lastOutcome={id:f.cast.id??'legacy',at:t,ok:false,label:'上一竿已脱钩',kind:'escape'}}
  s.coins-=2*rods;if(a.bait)f.items.river_bait-=rods;if(a.line)f.items.strong_line-=rods;delete f.lastOutcomes
  const biteAt=t+5+random(7)
  f.cast={v:3,rods,id:crypto.randomUUID(),_secret:random(0x7fffffff),rod:f.gear.rod,line:a.line===true,bait:a.bait===true,point:{x:Number(p.x),y:Number(p.y)},pattern:Array.from({length:12},()=>.2+random(81)/100),started:t,biteAt,expires:biteAt+12} satisfies FishingCastV3
  return `已抛出${rods}杆，等待浮漂下沉；共同收放线，每杆独立掉落与脱钩`
 }
 const cast=f.cast as FishingCastV3|undefined
 if(cast?.v!==3)return null
 if(a.type==='fish_reel'){
  fields(a,['castId']);require(a.castId===cast.id,'鱼竿已变化，请刷新');require(!cast.reelAt&&t>=cast.biteAt&&t<=cast.expires,'请在浮漂下沉时提竿');cast.reelAt=t;cast.expires=t+26;return '已钩住：按住收线，张力升高时松开放线'
 }
 if(a.type==='fish_abandon'){
  fields(a,['castId']);require(a.castId===cast.id,'鱼竿已变化');f.escaped=(f.escaped??0)+(cast.rods??1);f.lastOutcome={id:cast.id,at:t,ok:false,label:'已收起鱼竿，本组未获得物品',kind:'escape'};delete f.cast;return f.lastOutcome.label
 }
 if(a.type!=='fish_catch')return null
 fields(a,['castId','moves','duration']);require(a.castId===cast.id&&cast.reelAt!==undefined,'请先在咬钩时提竿')
 validateFishingMoves(a.moves,a.duration);const ms=Number(a.duration)
 require(ms<=(t-cast.reelAt!)*1000+1000,'遛鱼时间尚未满足')
 const replay=fishingFrame(cast as FishingFight,a.moves,ms)
 require(replay.status!=='playing'||t>cast.expires,'请继续遛鱼，尚未收服')
 require(Number.isSafeInteger(cast._secret),'鱼竿状态无效，请联系管理员')
 const outcomes:FishingOutcome[]=[],fishItems:Record<string,number>={}
 for(let rod=0;rod<(cast.rods??1);rod++){
 const seed=rod===0?cast._secret!:roll(cast._secret!,1009*rod,0x7fffffff),escaped=replay.status!=='landed'||t>cast.expires||roll(seed,71,100)<(cast.line?2:8)
 if(escaped){f.escaped=(f.escaped??0)+1;f.lastOutcome={id:cast.id,at:t,ok:false,label:replay.reason||'鱼儿最后一挣，脱钩了',kind:'escape'};outcomes.push({...f.lastOutcome,id:cast.id+':'+rod});continue}
 const draw=roll(seed,19,100),fishLimit=cast.bait?60:70,base=draw-fishLimit;let kind='fish',item='',n=1,label=''
 if(draw<fishLimit){
  const spec=FISH[roll(seed,37,FISH.length)];require((f.basket[spec.id]??0)<1000,'鱼篓已满，整理后可重试本次入篓');item=spec.id;f.basket[item]=(f.basket[item]??0)+1;f.discovery[item]=(f.discovery[item]??0)+1;f.caught++;fishItems[item]=(fishItems[item]??0)+1;label=spec.name+' ×1'
 }else if(base<9){
  kind='crop';item=['carrot','cabbage','wheat'][roll(seed,51,3)];require(s.produce&&(s.produce[item]??0)<10000,'作物仓已满，整理后可重试');s.produce![item]=(s.produce![item]??0)+1;addStock(s,'crop:'+item,'grown',1);label=['胡萝卜','包菜','小麦'][['carrot','cabbage','wheat'].indexOf(item)]+' ×1'
 }else if(base<16){
  kind='seeds';item=['carrot','cabbage','wheat'][roll(seed,55,3)];n=2;require(s.seeds&&(s.seeds[item]??0)+n<=10000,'种子仓已满，整理后可重试');s.seeds![item]=(s.seeds![item]??0)+n;label=['胡萝卜','包菜','小麦'][['carrot','cabbage','wheat'].indexOf(item)]+'种子 ×2'
 }else if(base<21){kind='coins';n=3+roll(seed,61,6);s.coins+=n;label='沉底零钱袋 · '+n+' D币'
 }else if(draw===99){kind='title';f.treasures=(f.treasures??0)+1;label='获得「锦鲤附体」称号成长进度'
 }else{kind='item';const def=FISHING_ITEMS[roll(seed,43,FISHING_ITEMS.length)];item=def.id;require((f.items[item]??0)<9999,'道具包已满，使用后可重试');f.items[item]=(f.items[item]??0)+1;label=def.name+' ×1'}
 f.landed=(f.landed??0)+1;s.xp++;outcomes.push({id:cast.id+':'+rod,at:t,ok:true,label,kind,item,count:n})
 }
 if(Object.keys(fishItems).length)f.lastCatch={at:t,items:fishItems}
 f.lastOutcomes=outcomes;const landed=outcomes.filter(x=>x.ok).length;f.lastOutcome=outcomes.length===1?{...outcomes[0],id:cast.id}:{id:cast.id,at:t,ok:landed>0,kind:'batch',label:`${outcomes.length}杆收起 · 获得${landed}份收获 · 脱钩${outcomes.length-landed}杆`};delete f.cast;return f.lastOutcome.label
}
