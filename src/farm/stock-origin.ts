export type StockOrigins=Record<string,{grown:number;stolen:number}>
type StockState={stockOrigins?:StockOrigins}
export function stockBreakdown(s:StockState,key:string,total:number){
 const saved=s.stockOrigins?.[key],grown=Math.min(total,Math.max(0,saved?.grown??0)),stolen=Math.min(total-grown,Math.max(0,saved?.stolen??0))
 return {grown,stolen,legacy:Math.max(0,total-grown-stolen)}
}
export function addStock(s:StockState,key:string,source:'grown'|'stolen',n:number){
 s.stockOrigins??={};const entry=s.stockOrigins[key]??={grown:0,stolen:0};entry[source]+=n
}
export function consumeStock(s:StockState,key:string,total:number,n:number,source:unknown){
 const parts=stockBreakdown(s,key,total)
 if(source!==undefined&&(typeof source!=='string'||!['grown','stolen','legacy'].includes(source)))throw Error('库存来源无效')
 if(source!==undefined){const k=source as keyof typeof parts;if(parts[k]<n)throw Error('所选来源的库存不足');parts[k]-=n}
 else{let left=n;for(const k of ['legacy','grown','stolen'] as const){const take=Math.min(left,parts[k]);parts[k]-=take;left-=take}}
 s.stockOrigins??={};if(parts.grown||parts.stolen)s.stockOrigins[key]={grown:parts.grown,stolen:parts.stolen};else delete s.stockOrigins[key]
}
