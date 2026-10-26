export const hex = (buf: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
export const randHex = (n = 32) => hex(crypto.getRandomValues(new Uint8Array(n)))
export const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
export const hmacHex = async (secret: string, value: string) => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))
}
export const verifyHmac = async (secret: string, value: string, signature: string) => {
  if (!/^[a-f0-9]{64}$/.test(signature)) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['verify'])
  return crypto.subtle.verify('HMAC', key, Uint8Array.from(signature.match(/../g)!, b => parseInt(b,16)), new TextEncoder().encode(value))
}
