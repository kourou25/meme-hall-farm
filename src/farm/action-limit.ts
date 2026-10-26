import {fail} from '../lib/http'
// One bounded row per account; official bulk actions spend one unit per target.
// Transactional endpoints share this budget rather than letting a script rotate paths.
export async function farmActionLimit(db:D1Database,uid:number,t:number,units:number){
 if(!Number.isInteger(units)||units<1||units>360)return fail(400,'操作计量无效')
 const quota=await db.prepare(`INSERT INTO farm_action_limits(user_id,minute,units) VALUES(?,?,?)
  ON CONFLICT(user_id) DO UPDATE SET minute=excluded.minute,units=CASE WHEN minute=excluded.minute THEN units+excluded.units ELSE excluded.units END
  WHERE minute<>excluded.minute OR units+excluded.units<=360 RETURNING units`).bind(uid,Math.floor(t/60),units).first()
 if(!quota)return fail(429,'操作过于密集，请稍后再试；官方批量照料仍可使用')
}
