import {farmCompensation} from './compensation'
import type {FarmState} from './rules'
export type FarmWalletSave={revision:number;state:string;updated_at:number;balance:number;wallet_revision:number;migrated:number|null}
const query=`SELECT f.revision,f.state,f.updated_at,w.balance,w.revision AS wallet_revision,m.user_id AS migrated FROM farm_saves f LEFT JOIN coin52_wallets w ON w.user_id=f.user_id LEFT JOIN farm_migrations m ON m.user_id=f.user_id WHERE f.user_id=?`
export async function farmWallet(db:D1Database,userId:number,t:number):Promise<FarmWalletSave|null>{
 for(let retry=0;retry<3;retry++){
  const row=await db.prepare(query).bind(userId).first<FarmWalletSave>()
  if(!row)return null
  if(row.migrated!==null)return row
  if(row.balance===null){await db.prepare('INSERT OR IGNORE INTO coin52_wallets(user_id,updated_at) VALUES(?,?)').bind(userId,t).run();continue}
  const old=JSON.parse(row.state) as FarmState,bonus=farmCompensation(old,row.revision),sum=old.coins+bonus,balance=row.balance+sum
  if(!Number.isSafeInteger(balance)||balance<0)throw Error('农场余额异常，请联系管理员核对')
  const state={...old,version:2,coins:balance},attempt=crypto.randomUUID(),revisionStep=row.revision>0?1:0
  const result=await db.batch([
   db.prepare(`INSERT OR IGNORE INTO farm_migrations(user_id,version,original_revision,original_state,imported_coins,compensation,attempt,created_at)
    SELECT ?1,'farm-v2-20261020',?2,?3,?4,?5,?6,?7 WHERE EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?1 AND revision=?2)
    AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?1 AND revision=?8)
    AND EXISTS(SELECT 1 FROM users WHERE id=?1 AND kind='user' AND disabled=0)
    AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?1) RETURNING user_id`).bind(userId,row.revision,row.state,old.coins,bonus,attempt,t,row.wallet_revision),
   db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at) SELECT ?,'farm-import','farm-v2-20261020',?,?,?,? WHERE EXISTS(SELECT 1 FROM farm_migrations WHERE attempt=?)`).bind(userId,attempt,old.coins,row.balance+old.coins,t,attempt),
   db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at) SELECT ?,'farm-compensation','farm-v2-20261020',?,?,?,? WHERE ?>0 AND EXISTS(SELECT 1 FROM farm_migrations WHERE attempt=?)`).bind(userId,attempt+'-bonus',bonus,balance,t,bonus,attempt),
   db.prepare(`UPDATE coin52_wallets SET balance=?,revision=revision+1,updated_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM farm_migrations WHERE attempt=?)`).bind(balance,t,userId,attempt),
   db.prepare(`UPDATE farm_saves SET state=?,revision=revision+?,updated_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM farm_migrations WHERE attempt=?)`).bind(JSON.stringify(state),revisionStep,t,userId,attempt),
  ])
  if(result[0].results.length)return {...row,state:JSON.stringify(state),revision:row.revision+revisionStep,updated_at:t,balance,wallet_revision:row.wallet_revision+1,migrated:userId}
 }
 throw Error('农场正在同步，请稍后重试')
}
export function farmWalletActionStatements(db:D1Database,p:{userId:number;row:FarmWalletSave;encoded:string;balance:number;id:string;attempt:string;t:number}){
 return [
  db.prepare(`INSERT OR IGNORE INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
   SELECT ?1,'farm-action',?2,?3,?4,?5,?6 WHERE EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?1 AND revision=?7)
    AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?1 AND revision=?8)
    AND EXISTS(SELECT 1 FROM users WHERE id=?1 AND disabled=0 AND kind='user')
    AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?1) RETURNING id`).bind(p.userId,p.id,p.attempt,p.balance-p.row.balance,p.balance,p.t,p.row.revision,p.row.wallet_revision),
  db.prepare(`UPDATE coin52_wallets SET balance=?,revision=revision+1,updated_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM coin52_ledger WHERE user_id=? AND attempt=?)`).bind(p.balance,p.t,p.userId,p.userId,p.attempt),
  db.prepare(`UPDATE farm_saves SET state=?1,revision=revision+1,updated_at=?2,owner_operated_at=?2 WHERE user_id=?3 AND EXISTS(SELECT 1 FROM coin52_ledger WHERE user_id=?3 AND attempt=?4) RETURNING revision,state,updated_at`).bind(p.encoded,p.t,p.userId,p.attempt),
 ]
}
