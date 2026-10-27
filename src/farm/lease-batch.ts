import {MAX_FARM_PLOTS} from './capacity'
import {farmWallet} from './wallet'
import {emptyLeasePlot,LEASE_IDLE,LEASE_DEFAULT} from './leases'
import {farmActionLimit} from './action-limit'
import type {FarmState} from './rules'
import {fail} from '../lib/http'
import {sha256} from '../lib/crypto'

type RentItem={owner_id:number;plot:number;price:number;days:number;forced:boolean}
export async function rentLeaseBatch(db:D1Database,uid:number,b:Record<string,unknown>,t:number){
 const input=b.items as RentItem[]
 if(typeof b.id!=='string'||!/^[a-zA-Z0-9-]{16,64}$/.test(b.id)||b.confirm!==true||!Array.isArray(input)||!input.length||input.length>MAX_FARM_PLOTS||input.some(x=>!x||!Number.isSafeInteger(x.owner_id)||x.owner_id<1||x.owner_id===uid||!Number.isInteger(x.plot)||x.plot<0||x.plot>=MAX_FARM_PLOTS||!Number.isInteger(x.price)||x.price<1||x.price>10000||!Number.isInteger(x.days)||x.days<1||x.days>7||typeof x.forced!=='boolean'||x.forced&&(x.price!==LEASE_DEFAULT.price||x.days!==LEASE_DEFAULT.days))||new Set(input.map(x=>x.owner_id+':'+x.plot)).size!==input.length)return fail(400,'请选择不重复的空地并确认租金、期限（每次最多60块）')
 const items=input.map(({owner_id,plot,price,days,forced})=>({owner_id,plot,price,days,forced})).sort((a,b)=>a.owner_id-b.owner_id||a.plot-b.plot),hash=await sha256(JSON.stringify(items))
 const prior=async()=>{const row=await db.prepare('SELECT request_hash,result FROM farm_lease_batches WHERE user_id=? AND request_id=?').bind(uid,b.id).first<{request_hash:string;result:string}>();if(!row)return null;if(row.request_hash!==hash)return fail(409,'操作编号已用于另一组地块，请重新选择');return {...JSON.parse(row.result),duplicate:true}}
 const done=await prior();if(done)return done
 await farmActionLimit(db,uid,t,items.length)
 const tenant=await farmWallet(db,uid,t);if(!tenant)return fail(409,'请先打开自己的农场')
 const total=items.reduce((n,x)=>n+x.price,0);if(tenant.balance<total)return fail(400,`D币余额不足，所选地块共需 ${total} D币`)
 const owners=[...new Set(items.map(x=>x.owner_id))],saves=(await db.prepare(`SELECT f.user_id,f.revision,f.state,m.user_id AS migrated FROM json_each(?) j CROSS JOIN farm_saves f ON f.user_id=j.value LEFT JOIN farm_migrations m ON m.user_id=f.user_id`).bind(JSON.stringify(owners)).all<{user_id:number;revision:number;state:string;migrated:number|null}>()).results
 const indexed=new Map(saves.map(s=>[s.user_id,s]))
 for(const s of saves)if(s.migrated===null){const migrated=await farmWallet(db,s.user_id,t);if(migrated)Object.assign(s,migrated)}
 for(const item of items){const save=indexed.get(item.owner_id),p=save?(JSON.parse(save.state) as FarmState).plots[item.plot]:null;if(!p||p.crop)return fail(409,'所选土地已变化，请刷新后重新选择；本次未扣款')}
 const attempt=crypto.randomUUID(),leases=items.map((x,i)=>({...x,id:`${uid}-${b.id}-${i}`,owner_revision:indexed.get(x.owner_id)!.revision,forced:x.forced?1:0,expires_at:t+x.days*86400,attempt:attempt+'-'+i})),leaseJson=JSON.stringify(leases)
 const deltas=[{uid,delta:-total},...owners.map(owner=>({uid:owner,delta:items.filter(x=>x.owner_id===owner).reduce((n,x)=>n+x.price,0)}))],deltaJson=JSON.stringify(deltas)
 const result={count:items.length,total,balance:tenant.balance-total,leases:leases.map(l=>({id:l.id,owner_id:l.owner_id,plot:l.plot,expires_at:l.expires_at})),duplicate:false},gate='EXISTS(SELECT 1 FROM farm_lease_batches WHERE attempt=?)'
 const writes=[
  db.prepare(`INSERT OR IGNORE INTO farm_lease_batches(user_id,request_id,request_hash,attempt,result,created_at)
   SELECT ?1,?2,?3,?4,?5,?6 WHERE EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?1 AND revision=?7)
   AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?1 AND revision=?8 AND balance>=?9)
   AND NOT EXISTS(SELECT 1 FROM json_each(?10) j LEFT JOIN users u ON u.id=json_extract(j.value,'$.uid') LEFT JOIN coin52_wallets w ON w.user_id=u.id
    WHERE u.id IS NULL OR u.disabled<>0 OR u.kind<>'user' OR w.user_id IS NULL OR w.balance+json_extract(j.value,'$.delta')<0 OR w.balance>9007199254740991-json_extract(j.value,'$.delta')
    OR EXISTS(SELECT 1 FROM account_retirements WHERE source_id=u.id))
   AND NOT EXISTS(SELECT 1 FROM json_each(?11) j LEFT JOIN farm_saves f ON f.user_id=json_extract(j.value,'$.owner_id')
    WHERE f.user_id IS NULL OR f.revision<>json_extract(j.value,'$.owner_revision')
    OR (json_extract(j.value,'$.forced')=1 AND f.owner_operated_at>?6-${LEASE_IDLE})
    OR (json_extract(j.value,'$.forced')=1 AND EXISTS(SELECT 1 FROM farm_lease_buybacks b WHERE b.owner_id=f.user_id AND b.plot=json_extract(j.value,'$.plot')))
    OR (json_extract(j.value,'$.forced')=0 AND NOT EXISTS(SELECT 1 FROM farm_lease_offers o WHERE o.owner_id=f.user_id AND o.plot=json_extract(j.value,'$.plot') AND o.price=json_extract(j.value,'$.price') AND o.days=json_extract(j.value,'$.days')))
    OR EXISTS(SELECT 1 FROM farm_leases l WHERE l.owner_id=f.user_id AND l.plot=json_extract(j.value,'$.plot') AND l.state='active')) RETURNING attempt`)
   .bind(uid,b.id,hash,attempt,JSON.stringify(result),t,tenant.revision,tenant.wallet_revision,total,deltaJson,leaseJson),
  db.prepare(`INSERT INTO farm_leases(id,owner_id,tenant_id,plot,price,started_at,expires_at,forced,state,crop_state,attempt)
   SELECT json_extract(value,'$.id'),json_extract(value,'$.owner_id'),?,json_extract(value,'$.plot'),json_extract(value,'$.price'),?,json_extract(value,'$.expires_at'),json_extract(value,'$.forced'),'active',?,json_extract(value,'$.attempt') FROM json_each(?) WHERE ${gate}`)
   .bind(uid,t,JSON.stringify(emptyLeasePlot()),leaseJson,attempt),
  db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
   SELECT w.user_id,CASE WHEN w.user_id=? THEN 'farm-rent-pay' ELSE 'farm-rent-income' END,?,?||'-'||w.user_id,json_extract(j.value,'$.delta'),w.balance+json_extract(j.value,'$.delta'),?
   FROM json_each(?) j CROSS JOIN coin52_wallets w ON w.user_id=json_extract(j.value,'$.uid') WHERE ${gate}`).bind(uid,uid+'-'+b.id,attempt,t,deltaJson,attempt),
  db.prepare(`UPDATE coin52_wallets SET balance=balance+(SELECT json_extract(value,'$.delta') FROM json_each(?1) WHERE json_extract(value,'$.uid')=coin52_wallets.user_id),revision=revision+1,updated_at=?2 WHERE user_id IN(SELECT json_extract(value,'$.uid') FROM json_each(?1)) AND EXISTS(SELECT 1 FROM farm_lease_batches WHERE attempt=?3)`).bind(deltaJson,t,attempt),
  db.prepare(`UPDATE farm_saves SET revision=revision+1 WHERE user_id IN(SELECT json_extract(value,'$.uid') FROM json_each(?)) AND ${gate}`).bind(deltaJson,attempt),
  db.prepare(`DELETE FROM farm_lease_offers WHERE (owner_id,plot) IN(SELECT json_extract(value,'$.owner_id'),json_extract(value,'$.plot') FROM json_each(?)) AND ${gate}`).bind(leaseJson,attempt),
 ]
 const written=await db.batch(writes)
 if(!written[0].results.length)return await prior()??fail(409,'地块、挂牌价格或余额已变化，整笔租赁未扣款，请刷新后重选')
 return result
}
