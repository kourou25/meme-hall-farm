import type { Env } from '../env'
import type { C, User } from '../types'
import { fail } from '../lib/http'

// 频率限制总开关，默认关
export const rateOn = (c: C) => c.env.RATE_LIMIT === 'on'
export const needUser = (c: C): User => {
  const user = c.get('user') ?? fail(401, '请先登录')
  if (user.disabled || user.kind === 'bot') fail(403, '账号已停用，请联系管理员')
  return user
}
export const canManage = (u: User | null, ownerId: number | null) => !!u && (u.is_admin === 1 || u.id === ownerId)
// 群管：网站管理员，或者被任命的群管（role = gadmin），能管群成员、公告、入群申请、撤回消息
export const isChatAdmin = (u: { is_admin?: number | boolean | null; role?: string | null } | null | undefined) => !!u && (!!u.is_admin || u.role === 'gadmin')
// 旧用户名仅用于注册保留词；站长权限只认固定 ID，缺配置时拒绝授予。
export const ownerNames = (env: Env) => (env.ADMIN_USERNAMES ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
export const isOwner = (c: C, u: { id: number } | null | undefined) => !!u && (c.env.ADMIN_USER_IDS ?? '').split(',').some(raw => /^-?\d+$/.test(raw.trim()) && Number(raw.trim()) === u.id)
// AI接入与设置由站长和站点管理员共同管理；群管不继承全站模型配置权。
export const canManageAi = (c:C,u:Pick<User,'id'|'is_admin'|'role'>|null|undefined) => !!u&&(isOwner(c,u)||u.is_admin===1||u.role==='admin')
// 炫彩昵称：管理员一直有；users.fancy 1 = 授予、0 = 回收、NULL = 默认（信任等级 3 以上有）
export const isFancy = (u: { is_admin?: number | boolean | null; fancy?: number | null; trust_level?: number | null } | null | undefined) =>
  !!u && (!!u.is_admin || u.fancy === 1 || (u.fancy == null && (u.trust_level ?? 0) >= 3))
