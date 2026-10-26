// Fixed-step physics shared by the browser preview and authoritative settlement.
export type FishingMove=[number,0|1]
export type FishingFight={pattern:number[];rod:number;line:boolean}
export const FISHING_GAME={step:50,maxDuration:24000,maxMoves:64,minMoveGap:80}
export function fishingFrame(fight:FishingFight,moves:FishingMove[],duration:number){
 let tension=28,progress=8,high=0,low=0,move=0,held=false,status:'playing'|'landed'|'escaped'='playing',reason='',elapsed=0,force=0
 const end=Math.min(FISHING_GAME.maxDuration,Math.max(0,duration)),rod=Math.max(0,Math.min(3,fight.rod))
 for(let ms=0;ms<end;ms+=FISHING_GAME.step){
  while(move<moves.length&&moves[move][0]<=ms){held=moves[move][1]===1;move++}
  force=fight.pattern[Math.min(fight.pattern.length-1,Math.floor(ms/2000))]??.5
  const dt=Math.min(FISHING_GAME.step,end-ms)/1000
  tension=Math.max(0,Math.min(110,tension+(held?15+force*15-rod*1.8-(fight.line?3:0):-27)*dt))
  progress=Math.max(0,Math.min(100,progress+(held?14-force*3+rod*.5:-force*.75)*dt))
  high=tension>=96?high+dt:0;low=tension<=4?low+dt:0;elapsed=ms+dt*1000
  if(high>=.65||low>=2){status='escaped';reason=high>=.65?'鱼线绷断了':'鱼线太松，鱼儿脱钩';break}
  if(progress>=100){status='landed';break}
 }
 if(status==='playing'&&elapsed>=FISHING_GAME.maxDuration){status='escaped';reason='鱼儿挣脱了，请再试一竿'}
 return {tension,progress,force,held,status,reason,elapsed}
}
export function validateFishingMoves(raw:unknown,duration:unknown):asserts raw is FishingMove[]{
 if(!Number.isSafeInteger(duration)||Number(duration)<0||Number(duration)>FISHING_GAME.maxDuration)throw Error('遛鱼时长无效')
 if(!Array.isArray(raw)||raw.length<1||raw.length>FISHING_GAME.maxMoves)throw Error('遛鱼操作记录无效')
 let previous=-FISHING_GAME.minMoveGap,value=-1
 for(const entry of raw){
  if(!Array.isArray(entry)||entry.length!==2||!Number.isSafeInteger(entry[0])||entry[0]<0||entry[0]>Number(duration)||entry[0]-previous<FISHING_GAME.minMoveGap||![0,1].includes(entry[1])||entry[1]===value)throw Error('遛鱼操作顺序无效')
  previous=entry[0];value=entry[1]
 }
 if(raw[0][0]!==0||raw[0][1]!==1)throw Error('请从提竿开始记录操作')
}
