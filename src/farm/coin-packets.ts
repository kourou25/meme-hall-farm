import {farmWallet} from './wallet'
export function coinPacketInput(b:Record<string,unknown>){
 const total=Number(b.amount),count=Number(b.count),minutes=Number(b.minutes??1440),mode=String(b.kind)
 if(!Number.isSafeInteger(total)||total<1||total>20000||!Number.isSafeInteger(count)||count<1||count>100||total<count)throw Error('总额需为1至20000整数D币，1至100份且每份至少1币')
 if(!['fixed','random'].includes(mode)||mode==='fixed'&&total%count!==0)throw Error('普通红包总额需能整除份数')
 if(!Number.isSafeInteger(minutes)||minutes<1||minutes>10080)throw Error('有效期需为1分钟至7天')
 return {total,count,minutes,mode}
}
export function coinPacketSplit(total:number,count:number,mode:string){
 const values:number[]=[];let left=total
 for(let n=count;n>1;n--){const max=Math.min(left-n+1,Math.max(1,Math.floor(left/n*2))),amount=mode==='fixed'?total/count:1+crypto.getRandomValues(new Uint32Array(1))[0]%max;values.push(amount);left-=amount}
 values.push(left);return values
}
export async function ensureCoinWallet(db:D1Database,uid:number,t:number){
 await farmWallet(db,uid,t)
 await db.prepare(`INSERT OR IGNORE INTO coin52_wallets(user_id,updated_at) SELECT ?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND disabled=0 AND kind='user') AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?)`).bind(uid,t,uid,uid).run()
}
const active=`EXISTS(SELECT 1 FROM users WHERE id=?1 AND disabled=0 AND kind='user') AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=?1)`
export async function createCoinPacket(db:D1Database,p:{id:string;uid:number;group:number;body:Record<string,unknown>;t:number}){
 const {id,uid,group,body,t}=p,input=coinPacketInput(body),attempt=crypto.randomUUID(),prompt=String(body.prompt??'').trim().slice(0,120)
 await ensureCoinWallet(db,uid,t)
 const existing=await db.prepare('SELECT total,count,mode,expires_at,created_at FROM coin52_packets WHERE packet_id=? AND owner_id=?').bind(id,uid).first<{total:number;count:number;mode:string;expires_at:number;created_at:number}>()
 if(existing){if(existing.total!==input.total||existing.count!==input.count||existing.mode!==input.mode||existing.expires_at-existing.created_at!==input.minutes*60)throw Error('发送标识已用于另一份红包，请重新打开面板');return}
 const gate=`EXISTS(SELECT 1 FROM coin52_ledger WHERE user_id=? AND attempt=?)`
 const result=await db.batch([
  db.prepare(`INSERT OR IGNORE INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
   SELECT ?1,'packet-send',?2,?3,-?4,balance-?4,?5 FROM coin52_wallets WHERE user_id=?1 AND balance>=?4 AND ${active}
   AND EXISTS(SELECT 1 FROM chat_members WHERE user_id=?1 AND group_id=?6)
   AND (SELECT COUNT(*) FROM coin52_packets WHERE owner_id=?1 AND created_at>?5-60)<10 RETURNING id`).bind(uid,id,attempt,input.total,t,group),
  db.prepare(`UPDATE coin52_wallets SET balance=balance-?,revision=revision+1,updated_at=? WHERE user_id=? AND ${gate}`).bind(input.total,t,uid,uid,attempt),
  db.prepare(`INSERT INTO chat_messages(group_id,user_id,body,redpack_id,created_at,updated_at) SELECT ?,?,'[红包]',?,?,? WHERE ${gate}`).bind(group,uid,id,t,t,uid,attempt),
  db.prepare(`INSERT INTO chat_redpacks(id,message_id,secret,mode,game,prompt,phrase,image_index,mask,provider,external_ref,external_kind) SELECT ?,id,'D币奖励','open','coin52',?,'',0,4,'coin52','','' FROM chat_messages WHERE redpack_id=? AND ${gate}`).bind(id,prompt,id,uid,attempt),
  db.prepare(`INSERT INTO coin52_packets(packet_id,owner_id,group_id,mode,total,count,remaining,remaining_count,expires_at,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${gate}`).bind(id,uid,group,input.mode,input.total,input.count,input.total,input.count,t+input.minutes*60,t,uid,attempt),
  ...coinPacketSplit(input.total,input.count,input.mode).map((amount,slot)=>db.prepare(`INSERT INTO coin52_packet_slots(packet_id,slot,amount) SELECT ?,?,? WHERE ${gate}`).bind(id,slot,amount,uid,attempt)),
 ])
 if(!result[0].results.length){if(await db.prepare('SELECT 1 FROM coin52_packets WHERE packet_id=? AND owner_id=?').bind(id,uid).first())return;throw Error('余额不足、发送过快或群成员状态已变化，请刷新后重试')}
}
export async function claimCoinPacket(db:D1Database,id:string,uid:number,t:number){
 await ensureCoinWallet(db,uid,t)
 const attempt=crypto.randomUUID()
 const result=await db.batch([
  db.prepare(`UPDATE coin52_packet_slots SET recipient_id=?1,claimed_at=?3,attempt=?4 WHERE packet_id=?2
   AND slot=(SELECT MIN(slot) FROM coin52_packet_slots WHERE packet_id=?2 AND recipient_id IS NULL)
   AND recipient_id IS NULL AND NOT EXISTS(SELECT 1 FROM coin52_packet_slots WHERE packet_id=?2 AND recipient_id=?1)
   AND ${active} AND EXISTS(SELECT 1 FROM coin52_packets p JOIN chat_messages m ON m.redpack_id=p.packet_id JOIN chat_members cm ON cm.group_id=p.group_id AND cm.user_id=?1
     WHERE p.packet_id=?2 AND p.owner_id<>?1 AND p.expires_at>?3 AND p.refunded_at IS NULL AND p.remaining>0 AND m.deleted=0 AND m.created_at>=cm.joined_at)
   AND EXISTS(SELECT 1 FROM coin52_wallets WHERE user_id=?1 AND balance<=9007199254740991-amount) RETURNING amount`).bind(uid,id,t,attempt),
  db.prepare(`INSERT INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at) SELECT ?,'packet-claim',s.packet_id,?,s.amount,w.balance+s.amount,? FROM coin52_packet_slots s JOIN coin52_wallets w ON w.user_id=? WHERE s.attempt=?`).bind(uid,attempt,t,uid,attempt),
  db.prepare(`UPDATE coin52_wallets SET balance=balance+(SELECT amount FROM coin52_packet_slots WHERE attempt=?),revision=revision+1,updated_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM coin52_packet_slots WHERE attempt=?)`).bind(attempt,t,uid,attempt),
  db.prepare(`UPDATE coin52_packets SET remaining=remaining-(SELECT amount FROM coin52_packet_slots WHERE attempt=?),remaining_count=remaining_count-1 WHERE packet_id=? AND EXISTS(SELECT 1 FROM coin52_packet_slots WHERE attempt=?)`).bind(attempt,id,attempt),
  db.prepare(`UPDATE chat_messages SET updated_at=? WHERE redpack_id=? AND EXISTS(SELECT 1 FROM coin52_packet_slots WHERE attempt=?)`).bind(t,id,attempt),
 ])
 if(!result[0].results.length&&!await db.prepare('SELECT 1 FROM coin52_packet_slots WHERE packet_id=? AND recipient_id=?').bind(id,uid).first())throw Error('红包已领完、已过期，或你不能领取这份红包')
}
export async function refundCoinPacket(db:D1Database,id:string,t:number){
 const attempt=crypto.randomUUID()
 await db.batch([
  db.prepare(`INSERT OR IGNORE INTO coin52_ledger(user_id,kind,ref,attempt,delta,balance_after,created_at)
   SELECT p.owner_id,'packet-refund',p.packet_id,?,p.remaining,w.balance+p.remaining,? FROM coin52_packets p JOIN coin52_wallets w ON w.user_id=p.owner_id
   WHERE p.packet_id=? AND p.expires_at<=? AND p.refunded_at IS NULL AND p.remaining>0`).bind(attempt,t,id,t),
  db.prepare(`UPDATE coin52_wallets SET balance=balance+(SELECT delta FROM coin52_ledger WHERE attempt=?),revision=revision+1,updated_at=? WHERE user_id=(SELECT user_id FROM coin52_ledger WHERE attempt=?)`).bind(attempt,t,attempt),
  db.prepare(`UPDATE coin52_packets SET refunded_at=?,remaining=0,remaining_count=0 WHERE packet_id=? AND EXISTS(SELECT 1 FROM coin52_ledger WHERE attempt=?)`).bind(t,id,attempt),
  db.prepare(`UPDATE chat_messages SET updated_at=? WHERE redpack_id=? AND EXISTS(SELECT 1 FROM coin52_ledger WHERE attempt=?)`).bind(t,id,attempt),
 ])
}
export async function settleCoinPackets(db:D1Database,t:number){
 const rows=(await db.prepare('SELECT packet_id FROM coin52_packets WHERE refunded_at IS NULL AND remaining>0 AND expires_at<=? ORDER BY expires_at LIMIT 20').bind(t).all<{packet_id:string}>()).results
 for(const row of rows)await refundCoinPacket(db,row.packet_id,t)
}
export async function coinPacketView(db:D1Database,id:string,uid:number,t:number){
 const p=await db.prepare('SELECT * FROM coin52_packets WHERE packet_id=?').bind(id).first<{total:number;count:number;remaining:number;remaining_count:number;owner_id:number;expires_at:number;refunded_at:number|null;mode:string}>()
 if(!p)throw Error('D币红包不存在')
 const rows=(await db.prepare(`SELECT s.amount,s.claimed_at,u.name,u.username,s.recipient_id FROM coin52_packet_slots s JOIN users u ON u.id=s.recipient_id WHERE packet_id=? ORDER BY claimed_at,slot LIMIT 100`).bind(id).all<{amount:number;claimed_at:number;name:string;username:string;recipient_id:number}>()).results
 return {...p,owner:p.owner_id===uid,mine:rows.find(x=>x.recipient_id===uid)?.amount??null,recipients:rows,state:p.expires_at<=t?'expired':p.remaining_count===0?'exhausted':'active',currency:'D币'}
}
