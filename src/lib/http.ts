import { HTTPException } from 'hono/http-exception'
import type { C } from '../types'

export const fail = (status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 416 | 429 | 503, message: string, code?:string): never => {
  throw new HTTPException(status, { message, cause:code?{code}:undefined })
}
export const jsonBody = <T>(c: C) => c.req.json<T>().catch(() => ({}) as T)
export {safeNext} from '../shared/navigation'
export function sameOrigin(c:C){if(c.req.header('origin')!==new URL(c.req.url).origin)fail(403,'非法来源')}
export async function boundedJson(c: C, maxBytes = 16384): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:;|$)/i.test(c.req.header('content-type') ?? '')) fail(415, '请使用 JSON 请求')
  const reader = c.req.raw.body?.getReader()
  if (!reader) fail(400, '请求内容不能为空')
  let size = 0, text = ''
  const decoder = new TextDecoder()
  try {
    while (true) {
      const {done,value} = await reader!.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {await reader!.cancel();fail(413, '请求内容过大')}
      text += decoder.decode(value,{stream:true})
    }
    text += decoder.decode()
  } finally {reader!.releaseLock()}
  let body: unknown
  try {body = JSON.parse(text)} catch {fail(400, '请求格式不正确')}
  if (!body || Array.isArray(body) || typeof body !== 'object') fail(400, '请求格式不正确')
  return body as Record<string,unknown>
}
