import {fail} from '../lib/http'
import {sha256} from '../lib/crypto'
import {visitOuting} from './visit-outing'

// 旧客户端与断线重试仍可确认原回执，新操作统一进入同一冷却/事务。
export async function visitBatch(db:D1Database,uid:number,owner:number,b:Record<string,unknown>,t:number){
 if(Object.keys(b).some(k=>!['id','place','targets','revision'].includes(k)))fail(400,'批量参数无效')
 if(typeof b.id==='string'){
  const table=b.place==='ranch'?'farm_ranch_visits':'farm_visits',prior=await db.prepare(`SELECT request_hash FROM ${table} WHERE actor_id=?1 AND request_id=?2 AND NOT EXISTS(SELECT 1 FROM farm_outings WHERE actor_id=?1 AND request_id=?2)`).bind(uid,b.id).first<{request_hash:string}>()
  if(prior){if(prior.request_hash!==await sha256(JSON.stringify({owner,...b})))fail(409,'操作编号已使用');return {duplicate:true,message:'本次批量摘取已确认，没有重复获得物产'}}
 }
 return visitOuting(db,uid,owner,{...b,mode:'normal',max_fee:0},t)
}
