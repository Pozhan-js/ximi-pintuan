import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, openSync, closeSync, fstatSync, readSync, constants } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { privateWrite, profileDirectory } from './local.mjs'

export const BOOTSTRAP_REQUIREMENT_ID = 'book-connection-upgrade-v1'
export const CORE_REQUIRED_FILES = [
  'bootstrap.mjs', 'client.mjs', 'cli.mjs', 'heartbeat.mjs', 'heartbeat-process.mjs',
  'template-hook.mjs', 'install-update-hook.mjs', 'hook.mjs', 'updates.mjs', 'local.mjs',
  'merge.mjs', 'prds.mjs', 'project-config.mjs', 'sources.mjs', 'source-git.mjs', 'vercel-setup.mjs',
].map(name => `scripts/book-collaboration/${name}`).sort()
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const hash = value => createHash('sha256').update(value).digest('hex')
export const UPGRADE_RULE_FILES = ['AGENTS.md', '.agents/skills/book-guild/SKILL.md', 'docs/collaboration/connection-upgrade-task.md']
export function readUpgradeRules(cwd) {
  const maximum = 256 * 1024
  return { rules: UPGRADE_RULE_FILES.map(path => {
    let file
    try { file = safeFile(cwd, path) }
    catch (error) { if (path === 'AGENTS.md' && error.code === 'ENOENT') return { path, status: 'NOT_SET', sha256: null, content: '项目尚未设置 AGENTS.md' }; throw new Error(`升级规则缺失或路径不安全：${path}`) }
    const descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    try {
      const stat = fstatSync(descriptor)
      if (!stat.isFile() || stat.size > maximum) throw new Error(`升级规则超过 256 KiB 或不是普通文件：${path}`)
      const buffer = Buffer.alloc(maximum + 1); let length = 0, count
      while (length < buffer.length && (count = readSync(descriptor, buffer, length, buffer.length - length, null)) > 0) length += count
      if (length > maximum) throw new Error(`升级规则超过 256 KiB：${path}`)
      const bytes = buffer.subarray(0, length)
      return { path, status: 'READ', sha256: hash(bytes), content: bytes.toString('utf8') }
    } finally { closeSync(descriptor) }
  }) }
}
function safeFile(root, path) {
  let current = root
  if (lstatSync(current).isSymbolicLink()) throw new Error('客户端根目录是符号链接')
  for (const part of path.split('/')) { current = join(current, part); if (lstatSync(current).isSymbolicLink()) throw new Error('核心路径是符号链接') }
  if (!lstatSync(current).isFile()) throw new Error('核心路径不是普通文件')
  return current
}
export function connectionClientInfo(root = sourceRoot) {
  const files = {}, issues = []
  for (const path of CORE_REQUIRED_FILES) {
    try { files[path] = hash(readFileSync(safeFile(root, path))) }
    catch { issues.push(`缺少或不安全的客户端核心：${path}`) }
  }
  return { requirementId: BOOTSTRAP_REQUIREMENT_ID, revision: 1, clientVersion: 2,
    buildId: issues.length ? null : hash(JSON.stringify({ revision: 1, files })), files, issues }
}
// A running worker must keep its startup identity after files are upgraded on
// disk. Reporting a new disk hash would falsely imply its modules were reloaded.
const executionBuild = connectionClientInfo()
export function connectionClientProof() {
  const { requirementId, buildId, clientVersion } = executionBuild
  return { requirementId, buildId, clientVersion }
}
const quote = value => `'${value.replaceAll("'", "'\\''")}'`
export function templateHookCommands(cwd) {
  const script = join(cwd, 'scripts/book-collaboration/template-hook.mjs')
  return { command: `${quote(process.execPath)} ${quote(script)}`, commandWindows: `node "${script}"` }
}
export function hookConfigurationDigest(cwd) {
  const path = safeFile(cwd, '.codex/hooks.json')
  safeFile(cwd, 'scripts/book-collaboration/template-hook.mjs')
  const raw = readFileSync(path, 'utf8'), config = JSON.parse(raw), expected = templateHookCommands(cwd)
  const matching = config.hooks?.PreToolUse?.some(group => (!group.matcher || group.matcher === '.*') && group.hooks?.some(hook => hook.type === 'command' && hook.command === expected.command && hook.commandWindows === expected.commandWindows))
  if (!matching) throw new Error('本机 PreToolUse 未接入当前客户端 Hook；请运行 install-update-hook 后在 Codex 信任并加载')
  return hash(raw)
}
export function createBootstrap(cwd, config) {
  const directory = config.directory || profileDirectory(config.site, config.projectId, cwd)
  const recordPath = join(directory, `bootstrap-${hash(`${config.site}\n${config.projectId}\n${cwd}\n${hash(config.token || '')}`)}.json`)
  const read = () => existsSync(recordPath) ? JSON.parse(readFileSync(safeFile(directory, recordPath.slice(directory.length + 1)), 'utf8')) : {}
  const write = record => privateWrite(recordPath, record)
  const info = () => connectionClientInfo(cwd)
  const requireBuild = () => { const build = info(); if (!build.buildId) throw new Error(build.issues.join('；')); return build }
  return {
    install() {
      const build = requireBuild(), configurationDigest = hookConfigurationDigest(cwd)
      const previous = read()
      if (previous.installation?.buildId === build.buildId && previous.installation.configurationDigest === configurationDigest) return previous.installation
      const installation = { buildId: build.buildId, configurationDigest, installationFingerprint: hash(JSON.stringify({ buildId: build.buildId, configurationDigest })), installedAt: new Date().toISOString() }
      write({ ...previous, installation, observation: null }); return installation
    },
    observe(input) {
      if (input?.hook_event_name !== 'PreToolUse' || typeof input.session_id !== 'string' || !input.session_id.trim()) return false
      const build = requireBuild(), record = read(), configurationDigest = hookConfigurationDigest(cwd)
      if (record.installation?.buildId !== build.buildId || record.installation.configurationDigest !== configurationDigest) return false
      const observation = { observedAt: new Date().toISOString(), sessionIdHash: hash(input.session_id), configurationDigest }
      write({ ...record, observation }); return true
    },
    hookEvidence() {
      const build = requireBuild(), record = read(), configurationDigest = hookConfigurationDigest(cwd)
      if (record.installation?.buildId !== build.buildId || record.installation.configurationDigest !== configurationDigest || record.observation?.configurationDigest !== configurationDigest || !/^[a-f0-9]{64}$/.test(record.observation?.sessionIdHash || '') || !Number.isFinite(Date.parse(record.observation?.observedAt)) || !Number.isFinite(Date.parse(record.installation?.installedAt)) || Date.parse(record.observation.observedAt) < Date.parse(record.installation.installedAt)) throw new Error('尚未观察到安装后由当前 Codex 会话实际触发的 Hook；请在 /hooks 信任并加载，重读规则后再确认。直接 CLI 自测不算会话加载证据')
      return { requirementId: build.requirementId, buildId: build.buildId, hookEvidence: record.observation, rulesRead: true }
    },
    recordRulesRead(result) {
      const build = requireBuild(), execution = connectionClientProof()
      if (build.buildId !== execution.buildId) throw new Error('实际运行的客户端与本机工具文件版本不一致；请重新启动新版客户端后回读规则')
      const files = result.rules.map(({ path, status, sha256 }) => ({ path, status, sha256 }))
      if (files.length !== UPGRADE_RULE_FILES.length || files.some((file, index) => file.path !== UPGRADE_RULE_FILES[index] || !(file.status === 'READ' && /^[a-f0-9]{64}$/.test(file.sha256 || '') || file.path === 'AGENTS.md' && file.status === 'NOT_SET' && file.sha256 === null))) throw new Error('规则回读证据必须来自固定三文件的真实摘要')
      const rulesReadEvidence = { schemaVersion: 1, buildId: build.buildId, readAt: new Date().toISOString(), files }
      write({ ...read(), rulesReadEvidence }); return rulesReadEvidence
    },
    evidence(now = Date.now()) {
      const build = requireBuild(), record = read(), evidence = record.rulesReadEvidence
      const readAt = Date.parse(evidence?.readAt)
      if (!evidence || evidence.schemaVersion !== 1 || evidence.buildId !== build.buildId || evidence.buildId !== connectionClientProof().buildId || !Number.isFinite(readAt) || readAt > now || now - readAt > 60 * 60 * 1000) throw new Error('请在最近一小时内使用当前 AI 工具运行 read-upgrade-rules，真实回读固定规则后再确认升级')
      const current = readUpgradeRules(cwd).rules.map(({ path, status, sha256 }) => ({ path, status, sha256 }))
      if (JSON.stringify(current) !== JSON.stringify(evidence.files)) throw new Error('规则文件在回读后发生变化；请重新运行 read-upgrade-rules 后再确认')
      return { requirementId: build.requirementId, buildId: build.buildId, rulesReadEvidence: evidence, rulesRead: true }
    },
    acceptStatus(response) {
      const applicable = typeof response?.connectionUpgradeApplicable === 'boolean' ? response.connectionUpgradeApplicable : null
      write({ ...read(), connectionUpgradeApplicable: applicable, connectionUpgradeTask: applicable === true ? response.connectionUpgradeTask || null : null })
    },
    assertReady() {
      const record = read()
      if (record.connectionUpgradeApplicable === false) return
      if (record.connectionUpgradeApplicable !== true) throw new Error('升级前置任务适用范围尚未确认；请先 up 或 upgrade-status 核对服务端状态')
      const build = requireBuild(), current = record.connectionUpgradeTask
      if (current?.requirementId !== build.requirementId || current.buildId !== build.buildId || current.status !== 'COMPLETE') throw new Error('请先完成“升级连接工具”前置任务：up → read-upgrade-rules → complete-upgrade --rules-read；原开发任务和本地修改保留')
    },
  }
}
