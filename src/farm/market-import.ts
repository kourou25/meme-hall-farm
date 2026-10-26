import {inventoryCounts,MARKET_ITEMS} from './market-stock'
import {stockBreakdown} from './stock-origin'
import type {FarmState} from './rules'
export const HISTORIC_LIFE=7*86400
export function planMarketImport(original:FarmState,t:number){
 const state=structuredClone(original),counts=inventoryCounts(state)
 const entries=MARKET_ITEMS.flatMap(i=>{
  const quantity=Math.min(counts[i.key]??0,original.market?original.market.legacy[i.key]??0:counts[i.key]??0)
  if(!Number.isSafeInteger(quantity)||quantity<=0)return []
  const parts=original.market?stockBreakdown({stockOrigins:original.market.legacyOrigins},i.key,quantity):stockBreakdown(state,i.key,quantity)
  // Unknown historic provenance is shown as historic, never silently erased.
  // Normalize only the transferred old stock so source-specific sales conserve it.
  if(i.kind!=='fish'&&parts.legacy){state.stockOrigins??={};state.stockOrigins[i.key]??={grown:0,stolen:0};state.stockOrigins[i.key].grown+=parts.legacy}
  return ([['grown',quantity-parts.stolen],['stolen',parts.stolen]] as const).filter(([,n])=>n>0).map(([source,n])=>({id:'historic-'+crypto.randomUUID(),item:i.key,source,quantity:n,base:i.price*100,born:t,expires:t+HISTORIC_LIFE}))
 })
 state.market={version:1,legacy:{},legacyOrigins:{},importedAt:t}
 return {state,entries,quantity:entries.reduce((n,l)=>n+l.quantity,0)}
}
