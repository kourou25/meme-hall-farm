import type {FarmState} from './rules'
export function farmCompensation(state:FarmState,revision:number){
 if(state.version!==1||revision===0)return 0
 return 100+Math.min(1000,Math.floor(state.xp/100)*25)+Math.min(500,Math.floor(state.coins/1000)*10)+Math.max(0,state.plots.length-6)*10
}
