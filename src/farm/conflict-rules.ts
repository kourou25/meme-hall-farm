export const LEGACY_CONFLICT_RULES={fee:5,toolCost:2,maxTools:5,prepareSeconds:600,escrowSeconds:86400,protectionSeconds:28800,maxLootCents:5000,lootPercent:10,dailyLossPercent:20,attacksPerDay:3,defensesPerDay:2,pairCooldown:86400,minEnrollment:86400,uprisingSeconds:1800,uprisingCost:2,minAllies:2,maxAllies:4} as const
// Saved preparation timestamps identify old contracts; their paid terms remain unchanged.
export const CONFLICT_RULES={...LEGACY_CONFLICT_RULES,fee:1,toolCost:1,prepareSeconds:180,escrowSeconds:3600,protectionSeconds:7200,pairCooldown:7200,minEnrollment:0,uprisingSeconds:600,uprisingCost:1,minAllies:1,entryStakeCents:1000} as const
export const RAID_RULES={...CONFLICT_RULES,prepareSeconds:0,escrowSeconds:900,uprisingSeconds:120} as const
export const conflictBattleRules=(b:{starts_at:number;resolves_at:number})=>b.resolves_at-b.starts_at===LEGACY_CONFLICT_RULES.prepareSeconds?LEGACY_CONFLICT_RULES:b.resolves_at===b.starts_at?RAID_RULES:CONFLICT_RULES
export type ConflictTactic='sneak'|'rush'|'lure'
export type ConflictStance='patrol'|'barrier'|'decoy'
export function conflictChance(p:{attack_tools:number;defense_tools:number;tactic:ConflictTactic;stance:ConflictStance;guardian:number}){
 const counter={sneak:'patrol',rush:'barrier',lure:'decoy'}[p.tactic]===p.stance
 const a=100+18*Math.sqrt(p.attack_tools),d=100+18*Math.sqrt(p.defense_tools)+18*p.guardian+(counter?22:0)
 return Math.max(.15,Math.min(.8,.5+(a-d)/220))
}
export const conflictDay=(t:number)=>Math.floor((t+28800)/86400)
export const conflictDayStart=(t:number)=>conflictDay(t)*86400-28800
export function conflictLoot(quantity:number,unitCents:number,warehouseCents:number,remainingCents:number){
 const cap=Math.min(CONFLICT_RULES.maxLootCents,Math.max(unitCents,Math.floor(warehouseCents/10)),remainingCents)
 return Math.max(0,Math.min(quantity,Math.floor(cap/unitCents)))
}
// Unbiased rejection sampling; the roll never leaves the service before settlement.
export function conflictRoll(){let n:number;do{n=crypto.getRandomValues(new Uint32Array(1))[0]}while(n>=4294000000);return n%1000000}
