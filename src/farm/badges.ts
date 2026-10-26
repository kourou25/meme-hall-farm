import {FARM_BADGES,farmBadgeProgress} from '../shared/farm-badges'

// The exact committed snapshot guards both action CAS and historical backfill.
// Absolute progress is monotonic; retries never add a second reward.
export function farmBadgeStatements(db:D1Database,uid:number,state:string,revision:number,t:number,previous?:unknown){
 const progress=farmBadgeProgress(state),day=new Date(t*1000+8*3600000).toISOString().slice(0,10)
 const before=previous===undefined?null:farmBadgeProgress(previous)
 const awards=FARM_BADGES.filter(b=>progress[b.id]>=b.levels[0]&&(!before||progress[b.id]>before[b.id]))
 if(!awards.length)return []
 return [
  ...awards.map(b=>db.prepare(`INSERT INTO user_badges(user_id,badge,n,first_at,last_day)
    SELECT ?1,?2,?3,?4,?5 WHERE EXISTS(SELECT 1 FROM farm_saves f JOIN users u ON u.id=f.user_id
      WHERE f.user_id=?1 AND f.revision=?6 AND f.state=?7 AND u.disabled=0 AND u.kind='user')
    ON CONFLICT(user_id,badge) DO UPDATE SET n=excluded.n,last_day=MAX(user_badges.last_day,excluded.last_day)
    WHERE user_badges.n<excluded.n`).bind(uid,b.id,progress[b.id],t,day,revision,state)),
  ...awards.filter(b=>!before||b.levels.some(n=>before[b.id]<n&&progress[b.id]>=n)).map(b=>db.prepare(`INSERT OR IGNORE INTO user_unlocks(user_id,item,at)
    SELECT ?1,?2||':'||(CAST(j.key AS INTEGER)+1),?3 FROM json_each(?4) j WHERE j.value<=?5
      AND EXISTS(SELECT 1 FROM farm_saves f JOIN users u ON u.id=f.user_id WHERE f.user_id=?1 AND f.revision=?6 AND f.state=?7 AND u.disabled=0 AND u.kind='user')`).bind(uid,b.id,t,JSON.stringify(b.levels),progress[b.id],revision,state)),
  db.prepare(`UPDATE users SET deco=json_set(deco,'$.bn',(SELECT n FROM user_badges WHERE user_id=?1 AND badge=json_extract(users.deco,'$.bd')))
    WHERE id=?1 AND disabled=0 AND kind='user' AND json_valid(deco)
      AND json_extract(deco,'$.bd') IN (${FARM_BADGES.map(b=>"'"+b.id+"'").join(',')})
      AND EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?1 AND revision=?2 AND state=?3)
      AND EXISTS(SELECT 1 FROM user_badges WHERE user_id=?1 AND badge=json_extract(users.deco,'$.bd') AND n!=COALESCE(json_extract(users.deco,'$.bn'),0))`).bind(uid,revision,state),
 ]
}
