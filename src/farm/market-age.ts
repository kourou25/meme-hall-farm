import {shelfLife} from './market-rules.ts'
export type MarketAge={fresh_qty:number;fresh_seconds:number;fresh_at:number}
// Sum(qty * (expiry - anchor)), maintained by inventory deltas. Expiry settlement
// must finish before pricing. No per-player or per-lot scan is needed for a tick.
export function remainingStockSeconds(g:MarketAge,t:number){return Math.max(0,g.fresh_seconds-g.fresh_qty*Math.max(0,t-g.fresh_at))}
export function effectiveStock(g:MarketAge,t:number,growSeconds:number){
 return Math.floor(Math.max(0,Math.min(g.fresh_qty,remainingStockSeconds(g,t)/shelfLife(growSeconds))))
}
