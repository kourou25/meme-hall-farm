const QUOTE_TTL=20
type QuoteSnapshot={sampled_at:number;rows:Record<string,unknown>[]}
// Only anonymous market fields enter this edge cache. Authentication stays at
// the route, and balances, lots, expiry checks and trades always read D1.
export async function marketQuotes(db:D1Database,origin:string,t:number,item?:string,cache?:Cache):Promise<QuoteSnapshot>{
 const key=new Request(new URL('/__internal-cache/farm-market-age-v1/'+(item?'history/'+encodeURIComponent(item):'goods'),origin))
 const limit=item?144:192
 if(cache)try{
  const hit=await cache.match(key)
  if(hit){const value=await hit.json<QuoteSnapshot>();if(Number.isSafeInteger(value.sampled_at)&&value.sampled_at<=t&&t-value.sampled_at<QUOTE_TTL&&Array.isArray(value.rows)&&value.rows.length<=limit)return value}
 }catch{/* Cache eviction or outage must not prevent a market read. */}
 const rows=item?(await db.prepare('SELECT tick_at,price_cents,fresh_qty,sold,bought,effective_qty FROM farm_market_ticks WHERE item=? AND tick_at>=? AND tick_at<=? ORDER BY tick_at DESC LIMIT 144').bind(item,t-86400,t).all<Record<string,unknown>>()).results.reverse()
  :(await db.prepare('SELECT item,base_cents,price_cents,fresh_qty,effective_qty,tick_at FROM farm_market_goods ORDER BY item LIMIT 192').all<Record<string,unknown>>()).results
 const value={sampled_at:t,rows}
 if(cache)try{await cache.put(key,new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json','Cache-Control':`public, max-age=${QUOTE_TTL}`}}))}catch{/* Read succeeds even when the optional cache cannot be written. */}
 return value
}
