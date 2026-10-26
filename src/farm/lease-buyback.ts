import {CROPS,type FarmState} from './rules'
import {farmWallet} from './wallet'
import {emptyLeasePlot,type Lease} from './leases'
import {farmClosed} from './lifecycle'
import {fail} from '../lib/http'

export const LEASE_BUYBACK_COOLDOWN=48*3600
type Receipt={lease_id:string;owner_id:number;penalty:number;reward:number;cooldown_until:number}
export async function leaseBuybackQuote(db:D1Database,lease:Lease,owner:number,t:number){
 if(lease.owner_id!==owner)fail(403,'只有地主可以买回土地')
 if(farmClosed(t))fail(409,'农场已结束经营，租约将统一结算')
 if(lease.state!=='active'||lease.expires_at<=t)fail(409,'租约已结束，无需支付违约金')
 const cooldown=await db.prepare('SELECT cooldown_until FROM farm_lease_buybacks WHERE owner_id=? AND plot=? ORDER BY cooldown_until DESC LIMIT 1').bind(owner,lease.plot).first<{cooldown_until:number}>()
 if(cooldown&&cooldown.cooldown_until>t)fail(409,'这块地仍在违约冷却中，其他地块不受影响')
 const plot=JSON.parse(lease.crop_state) as FarmState['plots'][number],crop=CROPS.find(c=>c.id===plot.crop)
 if(plot.crop&&!crop)fail(409,'作物数据暂不支持，请联系管理员核对')
 // Both parties receive one complete harvest's existing base sell value in D coins.
 // Buyback compensation explicitly grants both parties the full crop yield.
 const quantity=crop?2:0
 return {lease_id:lease.id,revision:lease.revision,penalty:Math.ceil(lease.price*6/5),reward:crop?crop.sellPrice*quantity:0,crop:crop?.name??null,quantity,cooldown_seconds:LEASE_BUYBACK_COOLDOWN}
}
export async function buybackLease(db:D1Database,lease:Lease,owner:number,requestId:string,expected:{revision:unknown;penalty:unknown;reward:unknown},t:number){
 const prior=await db.prepare('SELECT lease_id,owner_id,penalty,reward,cooldown_until FROM farm_lease_buybacks WHERE lease_id=?').bind(lease.id).first<Receipt>()
 if(prior){if(prior.owner_id!==owner)fail(403,'只能查看自己的买回记录');return {...prior,duplicate:true}}
 const quote=await leaseBuybackQuote(db,lease,owner,t)
 if(expected.revision!==quote.revision||expected.penalty!==quote.penalty||expected.reward!==quote.reward)fail(409,'租地收成或报价已变化，请重新查看买回报价')
 const [landlord,tenant]=await Promise.all([farmWallet(db,owner,t),farmWallet(db,lease.tenant_id,t)])
 if(!landlord||!tenant)return fail(409,'双方农场正在同步，请稍后重试')
 if(landlord.balance<quote.penalty)fail(400,'D币余额不足以支付违约金')
 const landlordBalance=landlord.balance-quote.penalty+quote.reward,tenantBalance=tenant.balance+quote.penalty+quote.reward
 if(!Number.isSafeInteger(landlordBalance)||!Number.isSafeInteger(tenantBalance))fail(400,'余额超过可结算范围')
 const attempt=crypto.randomUUID(),gate='EXISTS(SELECT 1 FROM farm_lease_buybacks WHERE attempt=?)'
 const result=await db.batch([
  db.prepare(`INSERT OR IGNORE INTO farm_lease_buybacks(lease_id,owner_id,tenant_id,plot,request_id,attempt,penalty,reward,crop_state,created_at,cooldown_until)
   SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11
   WHERE EXISTS(SELECT 1 FROM farm_leases WHERE id=?1 AND owner_id=?2 AND tenant_id=?3 AND state='active' AND expires_at>?10 AND revision=?12)
   AND EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?2 AND revision=?13)
   AND EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?3 AND revision=?14)
   AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?2 AND revision=?15 AND balance>=?7)
   AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?3 AND revision=?16)
   AND (SELECT COUNT(*) FROM users WHERE id IN(?2,?3) AND disabled=0 AND kind='user')=2
   AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id IN(?2,?3))
   AND NOT EXISTS(SELECT 1 FROM farm_lease_buybacks WHERE owner_id=?2 AND plot=?4 AND cooldown_until>?10)
   RETURNING lease_id`).bind(lease.id,owner,lease.tenant_id,lease.plot,requestId,attempt,quote.penalty,quote.reward,lease.crop_state,t,t+LEASE_BUYBACK_COOLDOWN,lease.revision,landlord.revision,tenant.revision,landlord.wallet_revision,tenant.wallet_revision),
  db.prepare(`UPDATE farm_leases SET state='ended',crop_state=?,revision=revision+1 WHERE id=? AND ${gate}`).bind(JSON.stringify(emptyLeasePlot()),lease.id,attempt),
  db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
   SELECT user_id,CASE WHEN user_id=?1 THEN 'farm-buyback-pay' ELSE 'farm-buyback-income' END,?2,?3,
   CASE WHEN user_id=?1 THEN -?4 ELSE ?4 END,balance+CASE WHEN user_id=?1 THEN -?4 ELSE ?4 END,?5
   FROM coin52_wallets WHERE user_id IN(?1,?6) AND EXISTS(SELECT 1 FROM farm_lease_buybacks WHERE attempt=?3)`)
   .bind(owner,lease.id,attempt,quote.penalty,t,lease.tenant_id),
  db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
   SELECT user_id,'farm-buyback-crop',?1,?2||'-crop',?3,balance+?3+CASE WHEN user_id=?4 THEN -?5 ELSE ?5 END,?6
   FROM coin52_wallets WHERE user_id IN(?4,?7) AND ?3>0 AND EXISTS(SELECT 1 FROM farm_lease_buybacks WHERE attempt=?2)`)
   .bind(lease.id,attempt,quote.reward,owner,quote.penalty,t,lease.tenant_id),
  db.prepare(`UPDATE coin52_wallets SET balance=CASE WHEN user_id=? THEN ? ELSE ? END,revision=revision+1,updated_at=? WHERE user_id IN(?,?) AND ${gate}`)
   .bind(owner,landlordBalance,tenantBalance,t,owner,lease.tenant_id,attempt),
  db.prepare(`UPDATE farm_saves SET revision=revision+1 WHERE user_id IN(?,?) AND ${gate}`).bind(owner,lease.tenant_id,attempt),
  db.prepare(`DELETE FROM farm_lease_offers WHERE owner_id=? AND plot=? AND ${gate}`).bind(owner,lease.plot,attempt),
 ])
 if(!result[0].results.length){
  const done=await db.prepare('SELECT lease_id,owner_id,penalty,reward,cooldown_until FROM farm_lease_buybacks WHERE lease_id=? AND owner_id=?').bind(lease.id,owner).first<Receipt>()
  if(done)return {...done,duplicate:true}
  fail(409,'租约、余额或冷却状态已变化，本次未扣款，请刷新后重试')
 }
 return {...quote,balance:landlordBalance,cooldown_until:t+LEASE_BUYBACK_COOLDOWN,duplicate:false}
}
