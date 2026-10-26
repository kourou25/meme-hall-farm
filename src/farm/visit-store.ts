// D1 batch is a transaction. The insert gates BOTH revisions before either save
// changes. A server-generated attempt token gates the following updates, so a
// replay of a client request cannot apply the writes again.
export function farmVisitStatements(db:D1Database,p:{actor:number;owner:number;actorRevision:number;ownerRevision:number;actorState:string;ownerState:string;id:string;hash:string;attempt:string;cycle:string;plot:number;kind:'steal'|'water'|'animal_steal';crop:string;amount:number;t:number},table:'farm_visits'|'farm_ranch_visits'='farm_visits'){
 return [
  db.prepare(`INSERT OR IGNORE INTO ${table}(actor_id,owner_id,request_id,request_hash,attempt,cycle,plot,kind,crop,amount,created_at)
   SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11
   WHERE EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?1 AND revision=?12)
    AND EXISTS(SELECT 1 FROM farm_saves WHERE user_id=?2 AND revision=?13)
    AND (SELECT count(*) FROM users WHERE id IN (?1,?2) AND kind='user' AND disabled=0)=2
    AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id IN (?1,?2))
    AND (SELECT count(*) FROM ${table} WHERE actor_id=?1 AND created_at>=?11-60)<30
   RETURNING id`).bind(p.actor,p.owner,p.id,p.hash,p.attempt,p.cycle,p.plot,p.kind,p.crop,p.amount,p.t,p.actorRevision,p.ownerRevision),
  db.prepare(`UPDATE farm_saves SET state=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=? AND EXISTS(SELECT 1 FROM ${table} WHERE attempt=?)`).bind(p.ownerState,p.t,p.owner,p.ownerRevision,p.attempt),
  db.prepare(`UPDATE farm_saves SET state=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=? AND EXISTS(SELECT 1 FROM ${table} WHERE attempt=?)`).bind(p.actorState,p.t,p.actor,p.actorRevision,p.attempt),
 ]
}
