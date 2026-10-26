// Fixed-point D cents. Pure rules shared by transactions and numerical checks.
export const MARKET_RULES={tickSeconds:600,cooldownSeconds:600,shopPremiumPercent:10,rottenPercent:10,maxTrade:10000,minLife:7200,maxLife:172800} as const
export type MarketSave={version:1;legacy:Record<string,number>;legacyOrigins:Record<string,{grown:number;stolen:number}>;importedAt?:number}
export function consumeLegacy(s:{market?:MarketSave;stockOrigins?:Record<string,{grown:number;stolen:number}>},key:string,n:number,source?:unknown){
 if(!s.market)return false
 const total=s.market.legacy[key]??0,old=s.market.legacyOrigins[key]??{grown:0,stolen:0}
 const parts={grown:Math.min(total,old.grown),stolen:Math.min(total-Math.min(total,old.grown),old.stolen),legacy:0};parts.legacy=total-parts.grown-parts.stolen
 if(source!==undefined&&!['grown','stolen','legacy'].includes(String(source)))throw Error('库存来源无效')
 if(total<n||source!==undefined&&parts[source as keyof typeof parts]<n)throw Error('所选历史库存不足；新增收成请到行情仓库出售')
 let left=n
 for(const k of source===undefined?['legacy','grown','stolen'] as const:[source as keyof typeof parts]){
  const take=Math.min(left,parts[k]);left-=take
  if(k!=='legacy'){old[k]-=take;if(s.stockOrigins?.[key])s.stockOrigins[key][k]-=take}
 }
 s.market.legacyOrigins[key]=old;s.market.legacy[key]-=n;return true
}
const clamp=(v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v))
export function shelfLife(seconds:number){return clamp(seconds*4,MARKET_RULES.minLife,MARKET_RULES.maxLife)}
export function marketPrice(p:{price:number;base:number;fresh:number;sold:number;bought:number}){
 if(![p.price,p.base].every(n=>Number.isSafeInteger(n)&&n>0)||![p.fresh,p.sold,p.bought].every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('行情数据无效')
 if(!p.sold&&!p.bought)return p.price
 const depth=Math.max(100,p.sold+p.bought),targetStock=Math.max(200,depth*2)
 const stock=clamp((targetStock-p.fresh)/targetStock,-2,1),flow=clamp((p.bought-p.sold)/depth,-1,1)
 const target=clamp(p.base*Math.exp(.45*stock+.45*flow),p.base*.35,p.base*3)
 return Math.max(1,Math.round(clamp(p.price+.25*(target-p.price),p.price*.85,p.price*1.15)))
}
export function marketSplit(quantity:number,carry:number){
 if(!Number.isSafeInteger(quantity)||quantity<1||!Number.isInteger(carry)||carry<0||carry>9)throw Error('分流数量无效')
 const shop=Math.floor((quantity+carry)/10)
 return {shop,consumed:quantity-shop,carry:(quantity+carry)%10}
}
export function marketMoney(balance:number,remainder:number,deltaCents:number){
 if(![balance,remainder,deltaCents].every(Number.isSafeInteger)||balance<0||remainder<0||remainder>99)throw Error('结算金额无效')
 // Avoid multiplying the whole wallet by 100: large existing balances remain exact.
 const total=remainder+deltaCents,whole=Math.floor(total/100),next=balance+whole
 if(!Number.isSafeInteger(next)||next<0)throw Error('D币余额不足或超出可结算范围')
 return {balance:next,remainder:total-whole*100,delta:whole}
}
