import { createHash, randomUUID } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { git, privateWrite, readJson } from './local.mjs'
import { siteUrl } from './client.mjs'

export const CLIENT_VERSION = 2
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
const fail = message => { throw new Error(message) }
const hash = value => value === null ? null : createHash('sha256').update(value).digest('hex')
const equal = (left, right) => left === null || right === null ? left === right : left.equals(right)
const repoName = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]+$/.test(value) && !/\/(?:\.|\.\.)$|\.git$/.test(value)

export function validateManagedPath(value) {
  if (typeof value !== 'string' || !value || value.length > 240 || value.startsWith('/') || /[\\\x00-\x1f:*?"<>|]/.test(value)) fail('更新路径无效')
  if (value.split('/').some(part => !part || ['.', '..'].includes(part) || /[. ]$/.test(part) || /^\.git$|^\.env(?:\.|$)|^(?:credentials?(?:\.|$)|secrets?(?:\.|$)|\.ssh$|\.aws$|\.npmrc$|\.netrc$|id_rsa|id_ed25519)/i.test(part)) || /\.(pem|key|p12|pfx)$/i.test(value)) fail('更新范围不能包含父目录、Git 元数据或凭证文件')
  return value
}

export function validateTemplatePolicy(policy) {
  if (policy === null) return null
  if (!policy || !Number.isSafeInteger(policy.revision) || policy.revision < 1 || !Number.isFinite(Date.parse(policy.publishedAt)) || !Array.isArray(policy.sources) || !policy.sources.length || policy.sources.length > 10) fail('模板版本策略无效')
  if ((policy.policyId !== undefined || policy.sourceProjectId !== undefined) && (!/^[a-f0-9]{64}$/.test(policy.policyId || '') || !/^[a-zA-Z0-9-]{1,64}$/.test(policy.sourceProjectId || ''))) fail('模板策略来源身份无效')
  const ids = new Set(), paths = []
  const sources = policy.sources.map(source => {
    if (!source || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/.test(source.id) || ids.has(source.id) || !repoName(source.fullName) || !sha(source.commit) || !['PROJECT', 'TEMPLATE', 'SKILL'].includes(source.kind) || !['UPSTREAM', 'FILES'].includes(source.mode) || typeof source.version !== 'string' || !source.version.trim() || source.version.length > 80 || typeof source.summary !== 'string' || source.summary.length > 2000 || !Array.isArray(source.paths) || !source.paths.length || source.paths.length > 100) fail('模板更新来源无效')
    ids.add(source.id)
    for (const path of source.paths) {
      const normalized = validateManagedPath(path).toLowerCase()
      if (paths.some(previous => previous === normalized || previous.startsWith(normalized + '/') || normalized.startsWith(previous + '/'))) fail('模板更新路径重复或互相覆盖')
      paths.push(normalized)
    }
    return { id: source.id, kind: source.kind, mode: source.mode, fullName: source.fullName, commit: source.commit, version: source.version, summary: source.summary, paths: [...source.paths] }
  })
  return { revision: policy.revision, publishedAt: policy.publishedAt, sources, ...(policy.policyId ? { policyId: policy.policyId, sourceProjectId: policy.sourceProjectId } : {}) }
}

function runGit(cwd, args) {
  try { return execFileSync('git', args, { cwd, windowsHide: true, encoding: null, timeout: 30_000, maxBuffer: 8_000_000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' } }) }
  catch { fail(`无法核对模板 Git ${args[0]}；请确认来源、提交、仓库权限和网络`) }
}
function fetchSource(cwd, source, commit) {
  runGit(cwd, ['fetch', '--no-tags', '--no-write-fetch-head', `https://github.com/${source.fullName}.git`, commit])
  if (runGit(cwd, ['cat-file', '-t', commit]).toString().trim() !== 'commit') fail('模板来源不是精确 Git 提交')
}
function repositoryFile(cwd, commit, path) {
  const row = runGit(cwd, ['ls-tree', '-z', commit, '--', path]).toString().split('\0').filter(Boolean)
  if (!row.length) return { content: null, mode: 0o644 }
  if (row.length !== 1 || row[0].split('\t')[1] !== path || !/^(100644|100755) blob [a-f0-9]{40}\t/.test(row[0])) fail(`模板路径 ${path} 必须是普通文件，不能是目录、子模块或符号链接`)
  const object = row[0].split(' ')[2].split('\t')[0]
  return { content: runGit(cwd, ['cat-file', 'blob', object]), mode: row[0].startsWith('100755') ? 0o755 : 0o644 }
}
function repositoryPaths(cwd, commit, path) {
  return runGit(cwd, ['ls-tree', '-r', '-z', commit, '--', path]).toString().split('\0').filter(Boolean).map(row => {
    const name = row.split('\t')[1]
    if (!/^(100644|100755) blob [a-f0-9]{40}\t/.test(row) || !name) fail(`模板路径 ${path} 包含符号链接、子模块或其他非普通文件`)
    return validateManagedPath(name)
  })
}

function filePath(cwd, path) {
  validateManagedPath(path)
  const destination = resolve(cwd, path)
  if (!destination.startsWith(resolve(cwd) + sep)) fail('更新路径越出工作区')
  let cursor = cwd
  for (const part of path.split('/')) {
    cursor = join(cursor, part)
    try { if (lstatSync(cursor).isSymbolicLink()) fail(`更新路径 ${path} 包含符号链接，已保留现场`) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return destination
}
function localFile(cwd, path) {
  const destination = filePath(cwd, path)
  if (!existsSync(destination)) return { content: null, mode: 0o644 }
  const stat = lstatSync(destination)
  if (!stat.isFile() || stat.size > 8_000_000) fail(`更新路径 ${path} 不是可管理的普通文件`)
  return { content: readFileSync(destination), mode: stat.mode & 0o777 }
}
function mergeFile(directory, path, current, base, incoming) {
  if (equal(current, incoming) || equal(incoming, base)) return current
  if (equal(current, base)) return incoming
  if (current === null || base === null || incoming === null || [current, base, incoming].some(value => value.includes(0))) fail(`模板更新冲突：${path}；当前文件已保留，请先对照差异处理`)
  const inputs = ['current', 'base', 'incoming'].map((name, index) => {
    const file = join(directory, `${randomUUID()}-${name}`)
    writeFileSync(file, [current, base, incoming][index], { mode: 0o600, flag: 'wx' }); return file
  })
  const result = spawnSync('git', ['merge-file', '--stdout', ...inputs], { windowsHide: true, encoding: null, timeout: 30_000, maxBuffer: 8_000_000, stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.status !== 0 || result.error) fail(`模板更新冲突：${path}；当前文件已保留，请先对照差异处理`)
  return result.stdout
}
function applyManaged(cwd, item, staging, index) {
  const destination = filePath(cwd, item.path)
  const latest = localFile(cwd, item.path)
  if (!equal(latest.content, item.current.content) || latest.mode !== item.current.mode || git(cwd, 'diff', '--cached', '--name-only', '--', item.path)) fail(`同步期间 ${item.path} 发生变化，请保留现场后重试`)
  mkdirSync(dirname(destination), { recursive: true })
  let captured = null, temp = null
  try {
    if (item.current.content !== null) {
      // Capture the actual old inode before replacing it. A writer racing the
      // preceding check is retained here rather than silently overwritten.
      captured = `${destination}.${randomUUID()}.book-update-backup`
      renameSync(destination, captured)
      item.captured = captured
      const stat = lstatSync(captured)
      if (!stat.isFile() || stat.isSymbolicLink()) fail(`同步期间 ${item.path} 类型发生变化；原文件保留在 ${captured}`)
      const actual = readFileSync(captured)
      writeFileSync(join(staging, `${index}.captured`), actual, { mode: 0o600, flag: 'wx' })
      if (!equal(actual, item.current.content) || (stat.mode & 0o777) !== item.current.mode) fail(`同步期间 ${item.path} 发生并发修改，已保留实际版本`)
    }
    if (item.next.content !== null) {
      temp = `${destination}.${randomUUID()}.book-update.tmp`
      writeFileSync(temp, item.next.content, { mode: item.next.mode, flag: 'wx' })
      // A concurrently recreated destination must win; link never replaces it.
      linkSync(temp, destination)
    } else if (existsSync(destination)) fail(`同步期间 ${item.path} 被重新创建，未删除新修改`)
  } catch (error) {
    if (captured && !existsSync(destination)) {
      try { linkSync(captured, destination) } catch { /* Both versions remain for recovery. */ }
    }
    throw error
  } finally {
    if (temp && existsSync(temp)) unlinkSync(temp)
  }
}
function retainInodes(plan, staging) {
  return plan.flatMap((item, index) => {
    if (!item.captured || !existsSync(item.captured)) return []
    let file = join(staging, `${index}.inode`)
    try { linkSync(item.captured, file); unlinkSync(item.captured) }
    catch { file = item.captured }
    return [{ path: item.path, file, originalDigest: hash(item.current.content) }]
  })
}
function changedBackups(receipt) {
  return (receipt.backupHistory || []).filter(backup => {
    try { return !lstatSync(backup.file).isFile() || lstatSync(backup.file).isSymbolicLink() || hash(readFileSync(backup.file)) !== backup.originalDigest }
    catch { return true }
  })
}

/** Cache, consent, and receipts are separate so a heartbeat cannot overwrite a sync receipt. */
export function createTemplateUpdater(cwd, config, dependencies = {}) {
  const scope = { site: siteUrl(config.site), projectId: config.projectId }
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(scope.projectId || '')) fail('模板更新项目绑定无效')
  const metadataDirectory = dependencies.metadataDirectory || dirname(resolve(cwd, git(cwd, 'rev-parse', '--git-path', 'book-collaboration-update-policy.json')))
  const scopeKey = createHash('sha256').update(`${scope.site}\n${scope.projectId}`).digest('hex')
  const metadata = name => join(metadataDirectory, `book-collaboration-${scopeKey}-${name}`)
  const files = { policy: metadata('update-policy.json'), trust: metadata('update-trust.json'), receipt: metadata('update-receipt.json'), lock: join(metadataDirectory, 'book-collaboration-update.lock') }
  const sameScope = value => value && value.scope?.site === scope.site && value.scope?.projectId === scope.projectId
  const read = (name, fallback) => {
    if (!existsSync(files[name])) return fallback
    const data = readJson(files[name])
    if (!sameScope(data)) fail('模板更新记录属于另一站点或项目，不能复用当前绑定')
    return data
  }
  const save = (name, value) => privateWrite(files[name], { ...value, scope })
  const authority = updates => updates.sourceProjectId || scope.projectId
  const identity = updates => updates ? updates.policyId || hash(JSON.stringify(updates)) : null
  const policy = () => {
    const cached = read('policy', null)
    if (!cached) fail('尚未取得模板更新策略，请先运行 check-updates')
    return { ...cached, updates: validateTemplatePolicy(cached.updates) }
  }
  const report = () => {
    const receipt = read('receipt', {})
    const updates = read('policy', null)?.updates
    const effective = updates && receipt.appliedPolicyId === identity(validateTemplatePolicy(updates)) && !changedBackups(receipt).length ? receipt.effectiveRevision || 0 : 0
    return { clientVersion: CLIENT_VERSION, templateRevision: receipt.appliedRevision || 0, effectiveTemplateRevision: effective, ...(effective ? { effectiveTemplatePolicyId: receipt.appliedPolicyId } : {}) }
  }
  const trustedSources = updates => {
    const trust = read('trust', null)
    if (!trust) fail('尚未配置可信更新来源与旧版基线，请先运行 configure-updates --file <配置.json> 完成接入')
    if ((trust.authority || scope.projectId) !== authority(updates)) fail('模板发布来源项目已变化，请核对老师来源后重新配置可信更新来源')
    const receipt = read('receipt', {})
    return updates.sources.map(source => {
      const entry = trust.sources.find(item => item.id === source.id)
      if (!entry || entry.fullName !== source.fullName || entry.mode !== source.mode) fail(`更新来源 ${source.id} 尚未获得本机信任，请核对来源后重新配置`)
      if (source.paths.some(path => !entry.roots.some(root => path === root || path.startsWith(root + '/')))) fail(`更新来源 ${source.id} 扩大了管理范围，请核对后重新配置`)
      const baseline = receipt.sources?.[source.id]
      if (baseline && (baseline.fullName !== source.fullName || baseline.mode !== source.mode)) fail('更新回执来源已变化，不能复用旧版基线')
      return { source, originalBaseline: entry.baselineCommit, previous: baseline }
    })
  }
  return {
    report,
    assertIdle() {
      if (existsSync(files.lock)) fail('当前 worktree 仍在同步或恢复模板，先完成该操作再重新上号或切换项目')
    },
    acceptPolicy(updates) {
      const checked = validateTemplatePolicy(updates)
      const previous = read('policy', null)
      if (previous?.updates && checked && authority(previous.updates) === authority(checked)) {
        if (checked.revision < previous.updates.revision) fail('模板策略版本倒退，未覆盖已知更新')
        const content = value => JSON.stringify({ revision: value.revision, publishedAt: value.publishedAt, sources: value.sources })
        if (checked.revision === previous.updates.revision && (content(previous.updates) !== content(checked) || (previous.updates.policyId && checked.policyId && previous.updates.policyId !== checked.policyId))) fail('同一模板版本的内容发生变化，请重新核对发布记录')
      }
      save('policy', { updates: checked, checkedAt: new Date().toISOString() })
      return this.status()
    },
    configure(input) {
      const updates = policy().updates
      if (!updates) fail('负责人尚未发布模板版本，不能猜测更新来源')
      if (!input || !Array.isArray(input.sources) || input.sources.length !== updates.sources.length) fail('接入配置必须明确列出所有更新来源')
      const ids = new Set()
      const sources = input.sources.map(entry => {
        const source = updates.sources.find(item => item.id === entry.id)
        if (!source || ids.has(entry.id) || entry.fullName !== source.fullName || entry.mode !== source.mode) fail('可信更新来源与已发布策略不一致')
        ids.add(entry.id)
        if (!sha(entry.baselineCommit)) fail(`来源 ${entry.id} 必须登记准确的旧版模板基线 SHA，不能猜测基线`)
        if (!Array.isArray(entry.roots) || !entry.roots.length || entry.roots.length > 100) fail('请明确允许更新的文件或目录范围')
        const roots = entry.roots.map(validateManagedPath)
        if (source.paths.some(path => !roots.some(root => path === root || path.startsWith(root + '/')))) fail('可信管理范围未覆盖当前已发布路径')
        return { id: entry.id, fullName: entry.fullName, mode: entry.mode, roots, baselineCommit: entry.baselineCommit }
      })
      save('trust', { sources, authority: authority(updates) })
      return { configured: true, sources: sources.map(({ id, fullName, roots }) => ({ id, fullName, roots })) }
    },
    status() {
      const cached = read('policy', null), receipt = read('receipt', {})
      const updates = cached ? validateTemplatePolicy(cached.updates) : null
      let status = cached ? 'CURRENT' : 'UNCHECKED'
      if (updates) status = receipt.appliedRevision !== updates.revision || receipt.appliedPolicyId !== identity(updates) ? 'UPDATE_REQUIRED' : receipt.effectiveRevision !== updates.revision ? 'AWAITING_READBACK' : 'CURRENT'
      const recovery = changedBackups(receipt).map(({ path, file }) => ({ path, backup: file, digest: existsSync(file) && lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink() ? hash(readFileSync(file)) : null }))
      if (recovery.length) status = 'RECOVERY_REQUIRED'
      return { status, checkedAt: cached?.checkedAt || null, updates, recovery, ...report() }
    },
    read(path) {
      validateManagedPath(path)
      const cached = policy(), trust = read('trust', null)
      const allowed = cached.updates?.sources.some(source => source.paths.some(root => path === root || path.startsWith(root + '/'))) || trust?.sources.some(source => source.roots.some(root => path === root || path.startsWith(root + '/')))
      if (!allowed) fail('只能回读已登记或本人已允许的模板管理文件')
      const file = localFile(cwd, path)
      if (file.content === null || file.content.includes(0)) fail('回读文件不存在或不是文本文件')
      return { path, content: file.content.toString('utf8') }
    },
    assertReady({ maxAgeMs = 90_000 } = {}) {
      const cached = policy()
      if (!Number.isFinite(Date.parse(cached.checkedAt)) || Date.now() - Date.parse(cached.checkedAt) > maxAgeMs) fail('模板版本检查已过期，请恢复心跳或运行 check-updates 后继续')
      const state = this.status()
      if (state.status === 'RECOVERY_REQUIRED') fail('同步时打开的旧文件又产生修改，实际版本仍保留在恢复备份中。请先核对并运行 recover-updates 处理这些修改，再同步并确认；不要删除备份')
      if (state.status === 'UPDATE_REQUIRED') fail(`模板更新到第 ${state.updates.revision} 版，请先运行 sync-updates，保留当前任务修改并完成同步`)
      if (state.status === 'AWAITING_READBACK') fail('模板文件已同步；请重新读取新版 Skills、AGENTS.md 和任务要求，必要时重启心跳/会话，再运行 ack-updates --revision <版本> 确认生效')
    },
    async sync() {
      const updates = policy().updates
      if (!updates) return { status: 'CURRENT', changed: [] }
      if (changedBackups(read('receipt', {})).length) fail('恢复备份包含后续编辑，请先运行 recover-updates 处理，未继续同步或清理备份')
      const sources = trustedSources(updates)
      let lock
      try { lock = openSync(files.lock, 'wx', 0o600) }
      catch { fail('另一同步尚未完成，已保留当前工作区，请先核对同步状态') }
      const owner = `${process.pid}:${randomUUID()}`
      writeFileSync(lock, owner); closeSync(lock)
      const staging = mkdtempSync(join(dirname(files.lock), 'book-update-'))
      const plan = [], completed = [], sourceReceipts = {}
      let preserveBackup = false, writePhase = false
      try {
        for (const { source, originalBaseline, previous } of sources) {
          const fetch = dependencies.fetchSource || fetchSource
          await fetch(cwd, source, source.commit)
          const baselineCommits = new Set([originalBaseline, ...Object.values(previous?.files || {}).map(file => file.commit)])
          for (const baseline of baselineCommits) if (baseline !== source.commit) await fetch(cwd, source, baseline)
          if (source.mode === 'UPSTREAM') {
            const currentOrigin = git(cwd, 'remote', 'get-url', 'origin').replace(/^git@github\.com:|^https:\/\/github\.com\//, '').replace(/\.git$/, '')
            if (currentOrigin.toLowerCase() !== source.fullName.toLowerCase()) fail('项目上游来源与当前仓库不一致；分发到学员个人仓库或 fork，请老师使用 FILES 模式并核对旧版模板基线')
            if (!previous) runGit(cwd, ['merge-base', '--is-ancestor', originalBaseline, 'HEAD'])
          }
          const managed = new Set()
          for (const declared of source.paths) {
            const incomingPaths = repositoryPaths(cwd, source.commit, declared)
            const originalPaths = repositoryPaths(cwd, originalBaseline, declared)
            const previousPaths = Object.keys(previous?.files || {}).filter(path => path === declared || path.startsWith(declared + '/'))
            if (!incomingPaths.length && !originalPaths.length && !previousPaths.length) fail(`登记的模板路径 ${declared} 不存在，请负责人核对版本和路径`)
            for (const path of [...incomingPaths, ...originalPaths, ...previousPaths]) managed.add(path)
          }
          const fileReceipts = { ...previous?.files }
          for (const path of managed) {
            if (plan.some(item => item.path.toLowerCase() === path.toLowerCase())) fail('模板目录展开后存在 Windows 路径冲突')
            const baseline = previous?.files?.[path]?.commit || originalBaseline
            const current = localFile(cwd, path), base = repositoryFile(cwd, baseline, path), incoming = repositoryFile(cwd, source.commit, path)
            const content = mergeFile(staging, path, current.content, base.content, incoming.content)
            const next = { content, mode: current.content === null ? incoming.mode : current.mode }
            if (!equal(current.content, content) && git(cwd, 'diff', '--cached', '--name-only', '--', path)) fail(`更新文件 ${path} 已有暂存修改，请先保留并处理暂存内容；未改动文件或暂存区`)
            plan.push({ path, current, next })
            fileReceipts[path] = { commit: source.commit }
          }
          sourceReceipts[source.id] = { fullName: source.fullName, mode: source.mode, commit: source.commit, files: fileReceipts }
        }
        // Prepare everything first; neither conflicts nor concurrent edits can partially apply a batch.
        for (const item of plan) if (!equal(localFile(cwd, item.path).content, item.current.content)) fail(`同步期间 ${item.path} 发生变化，请暂停当前修改后重试`)
        privateWrite(join(staging, 'journal.json'), { revision: updates.revision, files: plan.map((item, index) => ({ path: item.path, backup: `${index}.original`, existed: item.current.content !== null, mode: item.current.mode, nextDigest: hash(item.next.content) })) })
        for (const [index, item] of plan.entries()) writeFileSync(join(staging, `${index}.original`), item.current.content || Buffer.alloc(0), { mode: 0o600, flag: 'wx' })
        for (const [index, item] of plan.entries()) {
          if (equal(item.current.content, item.next.content)) continue
          writePhase = true
          await dependencies.beforeWrite?.(item.path)
          applyManaged(cwd, item, staging, index); completed.push(item)
        }
        for (const item of plan) if (!equal(localFile(cwd, item.path).content, item.next.content)) fail(`同步期间 ${item.path} 又发生变化，保留现场后重试`)
        if (identity(policy().updates) !== identity(updates)) fail('同步期间老师发布了新版本，请重新检查更新')
        const backupHistory = [...(read('receipt', {}).backupHistory || []), ...retainInodes(plan, staging)]
        preserveBackup = writePhase
        save('receipt', { appliedRevision: updates.revision, appliedPolicyId: identity(updates), effectiveRevision: 0, appliedAt: new Date().toISOString(), sources: sourceReceipts, backupHistory, files: Object.fromEntries(plan.map(item => [item.path, hash(item.next.content)])) })
        return { status: changedBackups({ backupHistory }).length ? 'RECOVERY_REQUIRED' : 'AWAITING_READBACK', revision: updates.revision, changed: completed.map(item => item.path), backups: writePhase ? staging : null, note: '管理文件已合并；旧文件实际 inode 和恢复日志保留于 Git 元数据，保护仍打开文件的编辑器修改。重新读取规则并确认运行版本生效后再继续原任务。' }
      } catch (error) {
        preserveBackup = writePhase
        // Never overwrite work produced concurrently while restoring our own writes.
        const retained = []
        for (const [index, item] of [...completed].reverse().entries()) {
          try {
            const restore = { path: item.path, current: item.next, next: item.current }
            applyManaged(cwd, restore, staging, `restore-${index}`)
          } catch { retained.push(item.path) }
        }
        if (preserveBackup) {
          privateWrite(join(staging, 'recovery.json'), { files: plan.map(item => ({ path: item.path, captured: item.captured || null })), retained })
          fail(`${error.message}${retained.length ? `；并发修改已保留：${retained.join('、')}` : ''}；恢复日志与备份保存在 ${staging}`)
        }
        throw error
      } finally {
        if (existsSync(files.lock) && readFileSync(files.lock, 'utf8') === owner) unlinkSync(files.lock)
        if (!preserveBackup) rmSync(staging, { recursive: true, force: true })
      }
    },
    acknowledge(revision) {
      const updates = policy().updates, receipt = read('receipt', {})
      if (!updates || !Number.isSafeInteger(revision) || revision !== updates.revision || receipt.appliedRevision !== revision || receipt.appliedPolicyId !== identity(updates)) fail('待确认的模板版本已变化，请先检查并同步最新版本')
      if (changedBackups(receipt).length) fail('恢复备份又产生编辑，必须先恢复并重新核对，不能确认生效')
      for (const [path, digest] of Object.entries(receipt.files || {})) if (hash(localFile(cwd, path).content) !== digest) fail(`同步后 ${path} 又发生变化，请重新核对同步结果再确认生效`)
      save('receipt', { ...receipt, effectiveRevision: revision, acknowledgedAt: new Date().toISOString() })
      return { acknowledged: true, revision, note: '这是本机对已重读并生效的确认，不替代实际重新加载验证。' }
    },
    async recover(input) {
      const updates = policy().updates
      if (!updates) fail('没有已登记模板版本，不能猜测恢复范围')
      const sources = trustedSources(updates), previous = read('receipt', {}), pending = changedBackups(previous)
      if (!input || !Array.isArray(input.files) || !input.files.length || input.files.length > 100) fail('恢复配置须为 files 数组，每项明确 path 与核对后的完整文本 content')
      const supplied = new Set()
      for (const file of input.files) {
        validateManagedPath(file.path)
        if (supplied.has(file.path) || (file.content !== null && (typeof file.content !== 'string' || file.content.includes('\0') || Buffer.byteLength(file.content) > 8_000_000))) fail('恢复文件重复或文本无效')
        supplied.add(file.path)
      }
      if (pending.some(backup => !supplied.has(backup.path))) fail('仍有未经核对的后续编辑，恢复配置必须覆盖提示的全部文件')
      const reviewed = new Map()
      for (const backup of pending) {
        const file = input.files.find(item => item.path === backup.path)
        const expected = file.backupDigests?.[backup.file]
        if (!expected || hash(readFileSync(backup.file)) !== expected) fail('恢复备份未明确核对或再次变化，请使用 check-updates 返回的当前备份摘要并重新回读')
        reviewed.set(backup.file, expected)
      }
      let lock
      try { lock = openSync(files.lock, 'wx', 0o600) } catch { fail('另一同步或恢复尚未完成，请先核对状态') }
      const owner = `${process.pid}:${randomUUID()}`; writeFileSync(lock, owner); closeSync(lock)
      const staging = mkdtempSync(join(dirname(files.lock), 'book-update-')), plan = [], completed = []
      try {
        const sourceReceipts = structuredClone(previous.sources || {})
        for (const file of input.files) {
          const match = sources.find(({ source }) => source.paths.some(root => file.path === root || file.path.startsWith(root + '/')))
          if (!match) fail('恢复文件不属于已登记且本人已允许的模板管理范围')
          await (dependencies.fetchSource || fetchSource)(cwd, match.source, match.source.commit)
          const incoming = repositoryFile(cwd, match.source.commit, file.path)
          if (incoming.content === null) {
            const baseline = previous.sources?.[match.source.id]?.files?.[file.path]?.commit || match.originalBaseline
            await (dependencies.fetchSource || fetchSource)(cwd, match.source, baseline)
            if (repositoryFile(cwd, baseline, file.path).content === null && !previous.sources?.[match.source.id]?.files?.[file.path]) fail('恢复文件并非已知模板文件，未执行删除')
            if (file.content !== null) fail('老师已移除该文件；保留修改在恢复备份中，明确确认删除时 content 使用 null')
          } else if (file.content === null) fail('当前模板仍包含该文件，不能用恢复入口删除')
          const current = localFile(cwd, file.path)
          plan.push({ path: file.path, current, next: { content: file.content === null ? null : Buffer.from(file.content), mode: current.mode } })
          sourceReceipts[match.source.id] ||= { fullName: match.source.fullName, mode: match.source.mode, commit: match.source.commit, files: {} }
          sourceReceipts[match.source.id].files ||= {}
          sourceReceipts[match.source.id].files[file.path] = { commit: match.source.commit }
        }
        privateWrite(join(staging, 'journal.json'), { files: plan.map((item, index) => ({ path: item.path, backup: `${index}.original`, existed: item.current.content !== null, mode: item.current.mode })) })
        for (const [index, item] of plan.entries()) {
          writeFileSync(join(staging, `${index}.original`), item.current.content || Buffer.alloc(0), { mode: 0o600, flag: 'wx' })
          applyManaged(cwd, item, staging, index); completed.push(item)
        }
        if (identity(policy().updates) !== identity(updates)) fail('恢复期间发布版本变化，请重新核对')
        for (const [file, expected] of reviewed) if (hash(readFileSync(file)) !== expected) fail('恢复期间旧文件又产生编辑，未确认恢复完成')
        for (const item of plan) if (!equal(localFile(cwd, item.path).content, item.next.content)) fail('恢复期间工作文件又发生变化，未确认恢复完成')
        const backupHistory = (previous.backupHistory || []).map(backup => reviewed.has(backup.file) ? { ...backup, originalDigest: reviewed.get(backup.file), reviewedAt: new Date().toISOString() } : backup)
        backupHistory.push(...retainInodes(plan, staging))
        save('receipt', { ...previous, appliedRevision: 0, effectiveRevision: 0, sources: sourceReceipts, backupHistory })
        return { recovered: plan.map(item => item.path), backups: staging, next: '重新运行 sync-updates 并重读规则后确认生效；恢复备份仍保留。' }
      } catch (error) {
        for (const [index, item] of [...completed].reverse().entries()) {
          try { applyManaged(cwd, { path: item.path, current: item.next, next: item.current }, staging, `restore-${index}`) } catch { /* Keep all copies for recovery. */ }
        }
        fail(`${error.message}；恢复日志与实际旧版本保留在 ${staging}`)
      } finally {
        if (existsSync(files.lock) && readFileSync(files.lock, 'utf8') === owner) unlinkSync(files.lock)
      }
    },
  }
}
