// Product deadline in UTC+8. Runtime gate is independent of Cron timing.
export const FARM_CLOSE_AT = Date.parse('2026-10-28T12:00:00+08:00') / 1000
export const FARM_FAREWELL_ID = 'farm-farewell-20261028'
export const FARM_FAREWELL_BONUS = 100000
export const farmClosed = (t: number) => t >= FARM_CLOSE_AT
