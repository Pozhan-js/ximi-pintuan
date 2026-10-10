import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { resolve, join, relative, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { git, privateWrite } from './local.mjs'

export function requirePersonalProject(snapshot) {
  if (!snapshot.currentUser?.userId || snapshot.personalProject?.learnerId !== snapshot.currentUser.userId) throw new Error('--switch-project 和 --configure-project 仅可用于本人个人项目')
}
function metadataPath(cwd, name) { return resolve(cwd, git(cwd, 'rev-parse', '--git-path', name)) }
export function backupBinding(cwd, binding) {
  const path = metadataPath(cwd, `book-collaboration-binding-${randomUUID()}.json`)
  // An allowlist deliberately excludes device credentials and any unexpected fields.
  privateWrite(path, { site: binding.site, projectId: binding.projectId, ...(binding.changeId ? { changeId: binding.changeId } : {}) })
  return path
}
export function safeTrackedPath(cwd, path, tracked) {
  if (typeof path !== 'string' || !path || path.includes('\\') || path.split('/').some(p => !p || p === '.' || p === '..') || path.startsWith('/')) throw new Error(`来源路径无效：${path}`)
  if (!tracked.has(path)) throw new Error(`来源尚未跟踪：${path}`)
  const absolute = resolve(cwd, path)
  if (relative(cwd, absolute).startsWith(`..${sep}`)) throw new Error(`来源路径越出仓库：${path}`)
  let current = cwd
  for (const part of path.split('/')) {
    current = join(current, part)
    if (lstatSync(current).isSymbolicLink()) throw new Error(`来源路径越出仓库或包含符号链接：${path}`)
  }
  if (!lstatSync(absolute).isFile()) throw new Error(`来源不是普通文件：${path}`)
  if (git(cwd, 'ls-files', '--stage', '--', path).split('\n').some(line => line && !/^100(?:644|755) /.test(line))) throw new Error(`来源不是已跟踪普通文件：${path}`)
  return absolute
}
function dirtyConfiguration(cwd, path) {
  const indexedHash = git(cwd, 'ls-files', '--stage', '--', path).split(/\s+/)[1]
  // status can hide assume-unchanged/skip-worktree edits; compare the real bytes too.
  return !!git(cwd, 'status', '--porcelain', '--', path) || git(cwd, 'hash-object', '--', path) !== indexedHash
}
export function prepareProjectConfiguration(cwd, { snapshot, site, repository }) {
  requirePersonalProject(snapshot)
  const tracked = new Set(git(cwd, 'ls-files', '-z').split('\0').filter(Boolean))
  const paths = ['.book/project.json', 'deliveryguard.config.json', 'package.json', 'version-manifest.json'].filter(path => tracked.has(path))
  const entries = paths.map(path => {
    const absolute = safeTrackedPath(cwd, path, tracked)
    const before = readFileSync(absolute, 'utf8')
    const data = JSON.parse(before)
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`项目配置无效：${path}`)
    const original = JSON.stringify(data)
    const projectId = snapshot.project.id
    if (path === '.book/project.json') Object.assign(data, { projectId, site, role: 'learner', repository: { ...data.repository, fullName: repository.fullName, defaultBranch: repository.defaultBranch || 'main' } })
    if (path === 'deliveryguard.config.json') data.project = { ...data.project, id: projectId, name: snapshot.project.name }
    if (path === 'version-manifest.json') data.project = projectId
    const shellArgument = value => /^[a-zA-Z0-9.:/_-]+$/.test(value) ? value : `"${value.replace(/[\\"$`]/g, char => '\\' + char)}"`
    if (path === 'package.json') data.scripts = { ...data.scripts, 'guild:connect': `node scripts/book-collaboration/cli.mjs up --site ${shellArgument(site)} --project ${projectId}` }
    if (JSON.stringify(data) === original) return null
    if (dirtyConfiguration(cwd, path)) throw new Error(`配置文件有未提交修改，未迁移任何文件：${path}`)
    return { path, absolute, before, after: JSON.stringify(data, null, 2) + '\n' }
  }).filter(Boolean)
  return {
    apply() {
      if (!entries.length) return { paths: [], rollback: () => [] }
      // Recheck every target together before the first write; unrelated dirty source is allowed.
      for (const entry of entries) {
        safeTrackedPath(cwd, entry.path, tracked)
        if (dirtyConfiguration(cwd, entry.path) || readFileSync(entry.absolute, 'utf8') !== entry.before) throw new Error(`配置文件已变化，未迁移任何文件：${entry.path}`)
      }
      const directory = metadataPath(cwd, `book-project-backup-${randomUUID()}`)
      mkdirSync(directory, { mode: 0o700 })
      entries.forEach((entry, index) => writeFileSync(join(directory, `${index}.json`), entry.before, { mode: 0o600, flag: 'wx' }))
      privateWrite(join(directory, 'restore.json'), { files: entries.map((entry, index) => ({ path: entry.path, backup: `${index}.json` })) })
      const written = []
      const rollback = () => {
        const skipped = []
        for (const entry of written.reverse()) {
          try {
            safeTrackedPath(cwd, entry.path, tracked)
            if (readFileSync(entry.absolute, 'utf8') !== entry.after) { skipped.push(entry.path); continue }
            writeFileSync(entry.absolute, entry.before)
          } catch { skipped.push(entry.path) }
        }
        return skipped
      }
      try {
        for (const entry of entries) {
          safeTrackedPath(cwd, entry.path, tracked)
          if (readFileSync(entry.absolute, 'utf8') !== entry.before) throw new Error(`配置文件已并发变化：${entry.path}`)
          const temp = `${entry.absolute}.${randomUUID()}.tmp`
          try {
            writeFileSync(temp, entry.after, { mode: lstatSync(entry.absolute).mode & 0o777, flag: 'wx' })
            if (readFileSync(entry.absolute, 'utf8') !== entry.before) throw new Error(`配置文件已并发变化：${entry.path}`)
            renameSync(temp, entry.absolute); written.push(entry)
          } finally { if (existsSync(temp)) unlinkSync(temp) }
        }
      } catch (error) {
        const skipped = rollback()
        throw new Error(`${error.message}；备份：${directory}${skipped.length ? `；并发改动未回退：${skipped.join('、')}` : '；本次写入已回退'}`)
      }
      return { directory, paths: entries.map(entry => entry.path), rollback }
    },
  }
}
