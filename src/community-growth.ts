import {COMMUNITY_GROWTH} from './shared/community-growth'
type Values=Record<string,number>
export function communityProgressStatements(db:D1Database,uid:number,values:Values,t:number,gate:string,bindings:(string|number)[],maximum=false){
 const guard=gate.replace(/\?\d+/g,'?')
 const records=Object.entries(values).filter(([id,n])=>COMMUNITY_GROWTH.some(x=>x.series===id)&&Number.isSafeInteger(n)&&n>0).map(([metric,value])=>({metric,value}))
 if(!records.length)return []
 const definitions=COMMUNITY_GROWTH.filter(x=>records.some(r=>r.metric===x.series)),day=new Date((t+28800)*1000).toISOString().slice(0,10)
 return [
  db.prepare(`INSERT INTO community_progress(user_id,metric,value) SELECT ?,json_extract(value,'$.metric'),json_extract(value,'$.value') FROM json_each(?) WHERE ${guard}
    ON CONFLICT(user_id,metric) DO UPDATE SET value=${maximum?'excluded.value':'MIN(9007199254740991,community_progress.value+excluded.value)'} WHERE ${maximum?'community_progress.value<excluded.value':'community_progress.value<9007199254740991'}`).bind(uid,JSON.stringify(records),...bindings),
  db.prepare(`INSERT INTO user_badges(user_id,badge,n,first_at,last_day) SELECT ?,p.metric,p.value,?,? FROM community_progress p JOIN json_each(?) d ON json_extract(d.value,'$.series')=p.metric WHERE p.user_id=? AND p.value>=json_extract(d.value,'$.levels[0]') AND ${guard}
    ON CONFLICT(user_id,badge) DO UPDATE SET n=excluded.n,last_day=MAX(user_badges.last_day,excluded.last_day) WHERE user_badges.n<excluded.n`).bind(uid,t,day,JSON.stringify(definitions),uid,...bindings),
  db.prepare(`INSERT OR IGNORE INTO user_unlocks(user_id,item,at) SELECT ?,p.metric||':'||(CAST(l.key AS INTEGER)+1),? FROM community_progress p JOIN json_each(?) d ON json_extract(d.value,'$.series')=p.metric JOIN json_each(json_extract(d.value,'$.levels')) l WHERE p.user_id=? AND p.value>=l.value AND ${guard}`).bind(uid,t,JSON.stringify(definitions),uid,...bindings),
  db.prepare(`UPDATE users SET deco=json_set(deco,'$.bn',(SELECT n FROM user_badges WHERE user_id=users.id AND badge=json_extract(users.deco,'$.bd'))) WHERE id=? AND json_valid(deco) AND json_extract(deco,'$.bd') IN (SELECT json_extract(value,'$.metric') FROM json_each(?)) AND EXISTS(SELECT 1 FROM user_badges WHERE user_id=users.id AND badge=json_extract(users.deco,'$.bd') AND n!=COALESCE(json_extract(users.deco,'$.bn'),0)) AND ${guard}`).bind(uid,JSON.stringify(records),...bindings),
 ]
}
// Run only when opening the account, using indexed per-user rows; no history scan.
export async function syncCommunityGrowth(db:D1Database,uid:number,t:number){
 const [rows,wallet]=await Promise.all([
  db.prepare('SELECT p.metric,p.value FROM community_progress p LEFT JOIN user_badges b ON b.user_id=p.user_id AND b.badge=p.metric WHERE p.user_id=? AND p.value>COALESCE(b.n,0)').bind(uid).all<{metric:string;value:number}>(),
  db.prepare("SELECT w.balance,COALESCE(p.value,0) AS peak FROM coin52_wallets w LEFT JOIN community_progress p ON p.user_id=w.user_id AND p.metric='coins_peak' WHERE w.user_id=?").bind(uid).first<{balance:number;peak:number}>(),
 ])
 const values=Object.fromEntries(rows.results.filter(r=>r.value>=(COMMUNITY_GROWTH.find(d=>d.series===r.metric)?.levels[0]??Infinity)).map(r=>[r.metric,r.value]))
 if(wallet&&wallet.balance>wallet.peak)values.coins_peak=wallet.balance
 const statements=communityProgressStatements(db,uid,values,t,'EXISTS(SELECT 1 FROM users WHERE id=? AND disabled=0)',[uid],true)
 if(statements.length)await db.batch(statements)
}
