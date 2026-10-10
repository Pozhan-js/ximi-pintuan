import { createHmac, randomUUID } from 'node:crypto'

export function siteUrl(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('需要本站完整 HTTPS 地址') }
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('需要无凭证、无路径的本站 HTTPS 地址；只有本机可使用 HTTP')
  return url.origin
}
export async function call(config, action, input = {}) {
  const site = siteUrl(config.site)
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(config.projectId) || !/^[a-f0-9]{64}$/.test(config.token)) throw new Error('项目或设备配置无效')
  const body = { ...input, projectId: config.projectId, action, requestId: input.requestId || randomUUID() }
  const raw = JSON.stringify(body)
  const timestamp = String(Date.now())
  const signature = createHmac('sha256', config.token).update(`${timestamp}\n${raw}`).digest('hex')
  let response
  try { response = await fetch(`${site}/api/collaboration/device`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60_000), headers: { 'content-type': 'application/json', 'x-book-device-token': config.token, 'x-book-timestamp': timestamp, 'x-book-signature': signature }, body: raw }) }
  catch { throw new Error('无法连接实战协作站点；未确认操作成功，请核对网络与站点') }
  let result
  try { result = await response.json() } catch { throw new Error('协作服务未返回有效结果') }
  if (!response.ok || result.success !== true || result.data == null) {
    const error = new Error(String(result.message || '协作操作被拒绝').replaceAll(config.token, '[已隐藏]').slice(0, 600))
    error.status = response.status; error.code = result.code; throw error
  }
  return result.data
}
