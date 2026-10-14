import { existsSync } from 'node:fs'
import { readFile, realpath } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { sourceGitReader } from './source-git.mjs'
import { safeTrackedPath } from './project-config.mjs'
import { isFeishuPrd } from './prds.mjs'

export function sourceDigest(value) {
  const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}
const clipped = (value, max) => String(value || '').slice(0, max).trim()

/** Only registered, tracked metadata. No repository-wide content or secret scan. */
export async function scanProject(directory = process.cwd(), options = {}) {
  const git = (...args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', maxBuffer: 8_000_000 }).trim()
  const root = git('rev-parse', '--show-toplevel')
  const readGit = sourceGitReader(root)
  const origin = git('remote', 'get-url', 'origin')
  const expected = options.fullName
  const fullName = origin.replace(/^git@github\.com:|^https:\/\/github\.com\//, '').replace(/\.git$/, '')
  if (!expected || fullName.toLowerCase() !== expected.toLowerCase() || !/^(git@github\.com:|https:\/\/github\.com\/)/.test(origin)) throw new Error('当前仓库不属于所选项目，停止同步')
  const tracked = new Set(git('ls-files', '-z').split('\0').filter(Boolean))
  const read = async (path) => {
    if (!tracked.has(path)) throw new Error(`来源尚未跟踪：${path}`)
    safeTrackedPath(root, path, tracked)
    const actual = await realpath(resolve(root, path))
    if (!actual.startsWith(root + sep)) throw new Error(`来源路径越出仓库：${path}`)
    const data = await readFile(actual, 'utf8')
    if (data.length > 2_000_000) throw new Error(`来源文件过大：${path}`)
    return data
  }
  let manifest, version, current, registrationPath = 'version-manifest.json', openspecRoot = 'openspec/changes', repairsRoot = ''
  const items = [], warnings = []
  if (tracked.has('version-manifest.json') || existsSync(resolve(root, 'version-manifest.json'))) {
    manifest = JSON.parse(await read('version-manifest.json'))
    if (manifest.project !== options.projectId || !/^v\d+\.\d+\.\d+$/.test(manifest.currentVersion)) throw new Error('当前项目版本登记无效')
    version = manifest.currentVersion
    current = manifest.versions.find((v) => v.version === version)
    if (!current) throw new Error('找不到当前版本登记')
  } else {
    const config = JSON.parse(await read('deliveryguard.config.json'))
    if (config.schemaVersion !== 1 || config.project?.id !== options.projectId) throw new Error('DeliveryGuard 项目编号不匹配；请先运行 up --configure-project --site <本站地址> --project <本人个人项目编号>')
    version = options.currentVersion
    if (!/^v\d+\.\d+\.\d+$/.test(version || '')) throw new Error('当前项目版本登记无效：缺少服务端当前版本')
    const safeRelative = (value) => {
      if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('/') || value.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('DeliveryGuard 来源配置路径无效')
      return value
    }
    const versionsRoot = safeRelative(config.paths?.versions)
    openspecRoot = safeRelative(config.paths?.openspec)
    repairsRoot = safeRelative(config.paths?.repairs)
    if (versionsRoot !== '.deliveryguard/versions' || openspecRoot !== 'openspec/changes') throw new Error('暂不支持自定义 DeliveryGuard 来源路径；请使用 .deliveryguard/versions 和 openspec/changes')
    registrationPath = `${versionsRoot}/${version}.json`
    const data = JSON.parse(await read(registrationPath))
    if (data.schemaVersion !== 1 || data.version !== version || !Array.isArray(data.documents)) throw new Error('DeliveryGuard 当前版本登记无效')
    current = { documents: data.documents.map(doc => ({ ...doc, url: doc.ref })) }
    manifest = { pendingChanges: [] }
    // Repair formats are not yet supported; never treat acceptance/release metadata as evidence.
    if ([...tracked].some(path => path.startsWith(`${repairsRoot}/`))) warnings.push('DeliveryGuard Repair 元数据暂未同步；源状态不代表 CI 或验收通过')
  }
  const add = (id, kind, title, summary, path, sourceStatus, fileDigest, itemVersion = version, link = '', fix) => items.push({
    key: `${kind.toLowerCase()}:${sourceDigest(id)}`, kind, title: clipped(title, 120), summary: clipped(summary, 2500), version: itemVersion,
    path, link, sourceStatus: clipped(sourceStatus, 120), fileDigest, git: readGit(path, fix, kind === 'REQUIREMENT' ? title : undefined),
  })
  for (const entry of manifest.pendingChanges || []) {
    if (entry.version !== version) continue
    let referenceHash = ''
    if (entry.document && tracked.has(entry.document) && entry.document.startsWith('docs/')) referenceHash = sourceDigest(await read(entry.document))
    else if (entry.document) warnings.push(`登记文档未跟踪或不存在：${entry.document}`)
    add(entry.id || [entry.version, entry.date, entry.document, entry.topic], 'REQUIREMENT', entry.topic,
      `${entry.note || ''}\n来源文档：${entry.document || '未登记'}\n原始状态仅作参考，规则、范围和验收条件由 AI 工具阅读原文后整理。`,
      registrationPath, entry.status || '', sourceDigest({ entry, referenceHash }))
  }
  for (const doc of current.documents || []) {
    const internal = typeof doc.url === 'string' && doc.url.startsWith(`/collaboration/${options.projectId}/documents/`) && doc.url.split('/').length === 5 && /^[a-f0-9-]{36}$/.test(doc.url.split('/').at(-1))
    const repoDoc = typeof doc.url === 'string' && doc.url.startsWith(`https://github.com/${expected}/blob/`) && !/[?#]/.test(doc.url)
    if (!internal && !repoDoc && !isFeishuPrd(doc.url)) { warnings.push(`忽略不属于本项目的文档链接：${doc.title}`); continue }
    const localHash = ''
    add([version, doc.url], 'DOCUMENT', doc.title, `文档职责：${doc.type}；登记 revision：${doc.revision ?? '未登记'}。这是项目登记信息，未回读远端文档，不代表最新内容或审核通过。`,
      registrationPath, `登记 revision ${doc.revision ?? '未知'}`, sourceDigest({ doc, localHash }), version, doc.url)
  }
  for (const path of [...tracked].sort()) {
    if (/^docs\/repair\/cases\/[^/]+\/case\.json$/.test(path)) {
      const data = JSON.parse(await read(path))
      if (data.productVersion !== version) continue
      const resolution = { stage: data.stage || '', note: '' }
      add(data.id || path, 'BUG', data.title, `${resolution.note ? resolution.note + '\n' : ''}实际：${data.symptom?.actual || '未登记'}\n期望：${data.symptom?.expected || '未登记'}\n修复说明：${data.resolution?.summary || '未登记'}\n源状态不等于公会验收通过。`, path,
        `${resolution.stage} / ${data.status || ''}`, sourceDigest(data), version, '', data.resolution?.kind === 'code' && data.scope?.modules?.length && data.scope.modules.every(p => /^(packages|scripts)\//.test(p)) ? data.resolution.commit : undefined)
    }
    if (path.startsWith(`${openspecRoot}/`) && /^[^/]+\/proposal\.md$/.test(path.slice(openspecRoot.length + 1)) && !path.includes('/archive/')) {
      const proposal = await read(path)
      const taskPath = path.replace('proposal.md', 'tasks.md')
      const tasks = tracked.has(taskPath) ? await read(taskPath) : ''
      const total = (tasks.match(/^\s*- \[[ xX]\]/gm) || []).length
      const done = (tasks.match(/^\s*- \[[xX]\]/gm) || []).length
      add(path, 'OPENSPEC', path.slice(openspecRoot.length + 1).split('/')[0], `未归档 OpenSpec；任务勾选 ${done}/${total}。版本未显式登记，不自动归入 ${version}，勾选结果不作为审核或 CI 证据。\n${taskPath}`, path,
        `未归档 · ${done}/${total}`, sourceDigest({ proposal, tasks }), '')
    }
  }
  if (items.length > 1000 || new Set(items.map((i) => i.key)).size !== items.length) throw new Error('项目来源重复或超过容量，请核对登记')
  return { repository: options.repository, version, commit: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'), workingTreeDirty: !!git('status', '--porcelain'), items, warnings }
}

/** Receipts stay in Git metadata and are scoped by endpoint and device token hash. */
export async function synchronizeProject(config, call, readReceipt, writeReceipt, stopped = () => false) {
  const scan = await scanProject(config.workspace || process.cwd(), config)
  const scope = sourceDigest({ site: config.site, projectId: config.projectId, token: config.token })
  const saved = await readReceipt()
  const receipts = saved.scope === scope ? saved.items || {} : {}
  const pending = scan.items.filter((i) => (receipts[i.key]?.inputDigest || receipts[i.key]?.digest) !== sourceDigest(i))
  const results = []
  for (let offset = 0; offset < pending.length; offset += 20) {
    if (stopped()) break
    const batch = pending.slice(offset, offset + 20).map((i) => ({ ...i, expectedDigest: receipts[i.key]?.digest, expectedRevision: receipts[i.key]?.revision }))
    const response = await call(config, 'source.sync', { commit: scan.commit, items: batch })
    if (!Array.isArray(response.results) || response.results.length !== batch.length) throw new Error('项目同步返回不完整，未确认成功')
    const seen = new Set()
    for (const result of response.results) {
      const input = batch.find((i) => i.key === result.key)
      if (!input || seen.has(result.key) || !Number.isSafeInteger(result.revision) || result.revision < 1 || !/^[a-f0-9]{64}$/.test(result.digest) || !['created', 'updated', 'unchanged', 'conflict'].includes(result.status)) throw new Error('项目同步回执无效')
      seen.add(result.key)
      const { expectedDigest, expectedRevision, ...source } = input; void [expectedDigest, expectedRevision]
      const { git: _gitMetadata, ...content } = source; void _gitMetadata
      if (result.status !== 'conflict' && result.digest !== sourceDigest(content)) throw new Error('项目同步摘要不一致，未确认成功')
      if (result.status !== 'conflict') {
        const gitAcknowledged = !source.git || result.gitDigest === sourceDigest(source.git)
        receipts[result.key] = { digest: result.digest, inputDigest: gitAcknowledged ? sourceDigest(source) : result.digest, revision: result.revision }
        if (!gitAcknowledged && !scan.warnings.includes('云端尚未确认 Git 提交信息，请部署新版服务后重试')) scan.warnings.push('云端尚未确认 Git 提交信息，请部署新版服务后重试')
      }
      results.push(result)
    }
    await writeReceipt({ scope, items: receipts })
  }
  return { version: scan.version, scanned: scan.items.length, sent: results.length, conflicts: results.filter((r) => r.status === 'conflict').map((r) => r.key), warnings: scan.warnings }
}
