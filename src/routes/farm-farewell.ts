import {Hono} from 'hono'
import type {Ctx} from '../types'
import {needUser} from '../services/auth'
import {now} from '../lib/time'
import {FARM_CLOSE_AT,FARM_FAREWELL_ID,FARM_FAREWELL_BONUS,farmClosed} from '../farm/lifecycle'
export const farmFarewell=new Hono<Ctx>()
farmFarewell.get('/api/farm/farewell',async c=>{
 const u=needUser(c),t=now()
 const receipt=farmClosed(t)?await c.env.DB.prepare('SELECT status,asset_coins,bonus,details,paid_at FROM farm_farewell_recipients WHERE batch_id=? AND user_id=?').bind(FARM_FAREWELL_ID,u.id).first<{status:string;asset_coins:number;bonus:number;details:string|null;paid_at:number|null}>():null
 return c.json({closed:farmClosed(t),closes_at:FARM_CLOSE_AT,server_time:t,bonus:FARM_FAREWELL_BONUS,receipt:receipt?{...receipt,details:receipt.details?JSON.parse(receipt.details):null}:null,
  rules:['地里及租地当期作物按完整收成结算，已被取走的份额不重复补发。','仓库按截止时行情结算，过期产物按原规则10%回收；市场批次不与仓库重复累加。','剩余种子、饲料、存活动物购入价、扩建和鱼竿投入一并返还；当期畜产、育肥猪、挂机钓鱼计入收益。','未完攻防取消，未结算投入返还，仓库物资按原主人归属结算；剩余租期返还租客。','每个正常账号另获100000 D币；按批次陆续到账，无需手动领取。']})
})
