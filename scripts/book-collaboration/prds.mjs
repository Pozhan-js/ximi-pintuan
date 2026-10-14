import { execFileSync } from 'node:child_process'

export function isFeishuPrd(url) {
  if (typeof url !== 'string') return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port && !parsed.search && !parsed.hash &&
      /^(?:[a-z0-9-]+\.)?(?:feishu\.cn|larksuite\.com)$/.test(parsed.hostname) && /^\/(?:docx|wiki)\/[a-zA-Z0-9]+$/.test(parsed.pathname)
  } catch { return false }
}

export function versionPrds(snapshot) {
  const version = snapshot.project.versions?.find(v => v.version === snapshot.project.productVersion)
  return version ? [version.prd, ...(version.prds || [])].filter(d => d.url) : []
}

/** Read as the locally authorized learner. No app credentials or document writes. */
export function readFeishuPrds(references, profile, run = execFileSync) {
  const urls = [...new Set(references.map(d => d.url || d.ref).filter(isFeishuPrd))]
  if (!urls.length) return []
  if (!profile || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(profile)) throw new Error('请用 --profile 指定本人已授权的飞书 CLI 配置；不能使用老师的登录凭证')
  return urls.map(url => {
    let response
    try {
      response = JSON.parse(run('lark-cli', ['--profile', profile, 'docs', '+fetch', '--doc', url, '--as', 'user', '--format', 'json'], {
        encoding: 'utf8', timeout: 60000, maxBuffer: 2_000_000, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' },
      }))
    } catch {
      throw new Error(`无法读取飞书 PRD：${url}。请确认已安装 lark-cli、本人已授权文档读取且有此文档访问权限；不会回退到站内副本`)
    }
    const doc = response.data?.document
    if (response.ok !== true || response.identity !== 'user' || !doc || typeof doc.content !== 'string' || !doc.content.trim() || !/^\d+$/.test(String(doc.revision_id))) {
      throw new Error('飞书 CLI 未返回完整的用户身份文档及真实 revision；不能视为读取成功')
    }
    return { url, revision: String(doc.revision_id), documentId: doc.document_id, content: doc.content, referenceMap: doc.reference_map, fetchedAt: new Date().toISOString(), source: 'FEISHU_CLI' }
  })
}
