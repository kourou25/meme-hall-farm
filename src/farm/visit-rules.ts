// One outing can cover the complete 60-plot farm and 24-animal ranch.
export const VISIT_RULES={maxTargets:84,cooldown:60,pairCooldown:300,growth:0.5,feeRate:0.25,chance:0.7,guardedChance:0.4} as const
export const visitFee=(price:number)=>Math.max(1,Math.ceil(price*VISIT_RULES.feeRate))
