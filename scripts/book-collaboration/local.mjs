import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { homedir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { mergeState } from './merge.mjs'
import { siteUrl } from './client.mjs'

export function git(cwd, ...args) {
  try { return execFileSync('git', args, { cwd, windowsHide: true, encoding: 'utf8', maxBuffer: 2_000_000, timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd() }
  catch { throw new Error(`无法核对 Git ${args[0]}；请检查分支与完整历史`) }
}
export function workspace(cwd = process.cwd()) { return git(cwd, 'rev-parse', '--show-toplevel') }
export function bindingPath(cwd) { return resolve(cwd, git(cwd, 'rev-parse', '--git-path', 'book-collaboration.json')) }
export function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')) }
export function privateWrite(path, value) {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('配置路径不能是符号链接')
  const temp = `${path}.${randomUUID()}.tmp`
  writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' }); renameSync(temp, path); chmodSync(path, 0o600)
}
export function profileDirectory(site, projectId, cwd, { readOnly = false } = {}) {
  const root = join(homedir(), '.book-collaboration')
  if (existsSync(root) && lstatSync(root).isSymbolicLink()) throw new Error('设备目录不能是符号链接')
  if (!readOnly) { mkdirSync(root, { mode: 0o700, recursive: true }); chmodSync(root, 0o700) }
  const path = join(root, createHash('sha256').update(`${siteUrl(site)}\n${projectId}\n${cwd}`).digest('hex'))
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('设备目录不能是符号链接')
  if (!readOnly) { mkdirSync(path, { mode: 0o700, recursive: true }); chmodSync(path, 0o700) }
  return path
}
export function loadConfig(cwd, { readOnly = false } = {}) {
  if (process.env.BOOK_COLLABORATION_TOKEN) return { site: siteUrl(process.env.BOOK_COLLABORATION_SITE), projectId: process.env.BOOK_COLLABORATION_PROJECT, token: process.env.BOOK_COLLABORATION_TOKEN }
  if (!existsSync(bindingPath(cwd))) throw new Error('请先运行 up --site <本站地址> --project <项目编号>')
  const binding = readJson(bindingPath(cwd)); const directory = profileDirectory(binding.site, binding.projectId, cwd, { readOnly })
  const config = readJson(join(directory, 'device.json'))
  if (config.site !== binding.site || config.projectId !== binding.projectId) throw new Error('设备配置与工作区绑定不一致')
  return { ...config, directory, changeId: binding.changeId }
}
export function origin(cwd) {
  const value = git(cwd, 'remote', 'get-url', 'origin')
  if (!/^(git@github\.com:|https:\/\/github\.com\/)[\w.-]+\/[\w.-]+(?:\.git)?$/.test(value)) throw new Error('origin 必须是无凭证的 GitHub 仓库地址')
  return value
}
export function projectRepository(cwd, snapshot, site) {
  const fullName = origin(cwd).replace(/^git@github\.com:|^https:\/\/github\.com\//, '').replace(/\.git$/, '')
  const project = snapshot.project
  const repositories = project.integrations?.repositories || []
  const repository = repositories.find(r => r.fullName.toLowerCase() === fullName.toLowerCase())
  if (repository) return repository
  const current = `当前仓库 ${fullName} 与项目「${project.name}」(${project.id}) 不匹配。`
  const registered = repositories.length ? `此项目登记的仓库：${repositories.map(r => r.fullName).join('、')}。` : '此项目尚未登记仓库。'
  const entry = snapshot.personalProject ? `${siteUrl(site)}/collaboration/${project.id}/learning` : `${siteUrl(site)}/collaboration/routes?fromProject=${encodeURIComponent(project.id)}`
  throw new Error(`${current}${registered}学员请从 ${entry} 进入本人的个人项目，先创建或领取个人实战仓库，再按准备页的仓库地址和项目编号连接。这是团队项目时，团队开发由负责人核对仓库配置；个人练习请领取本人项目，不要把个人仓库登记到教师团队。`)
}
export function projectCommitContext(cwd, snapshot, site, { learnerDevelopment = true } = {}) {
  const repository = projectRepository(cwd, snapshot, site)
  if (learnerDevelopment && snapshot.personalProject && snapshot.personalProject.learnerId !== snapshot.currentUser?.userId) throw new Error('当前个人项目不属于本人；请从上号大厅进入本人的个人练习项目')
  const policy = snapshot.project.scopePolicy
  const rule = policy?.rules?.[snapshot.currentUser?.role]?.[repository.id]
  if (!policy || !Number.isSafeInteger(policy.revision) || policy.revision < 1 || (snapshot.currentUser?.userId !== snapshot.project.ownerId && (!Array.isArray(rule?.allow) || !Array.isArray(rule?.deny)))) {
    const guide = snapshot.personalProject
      ? `本人个人项目尚未完成提交权限初始化，请课程教师核对 ${siteUrl(site)}/collaboration/${snapshot.project.id}/learning；不会自动放宽目录权限。`
      : `当前是团队项目，提交目录权限尚未配置，请团队负责人核对。个人练习请从 ${siteUrl(site)}/collaboration/routes?fromProject=${encodeURIComponent(snapshot.project.id)} 领取本人项目；不要把个人仓库登记到教师团队。`
    throw new Error(guide)
  }
  return repository
}
export function previewCommit(input, snapshot, change, policy, commit, problems = []) {
  const issues = [...problems]
  const warnings = []
  if (change.phase === 'DONE') issues.push('目标任务已完成，不能作为当前提交任务')
  if (change.kind === 'DOCUMENT') issues.push('纯文档任务不能申请代码提交授权')
  const email = snapshot.currentUser?.verifiedEmail?.toLowerCase()
  if (!email) issues.push('本人尚未确认已验证 Git 邮箱')
  else {
    if (input.authorEmail !== email) issues.push('Git 作者与本人已验证邮箱不一致')
    if (input.committerEmail !== email) issues.push('Git 提交者与本人已验证邮箱不一致')
  }
  const outOfScopePaths = input.paths.filter(path => !(change.scopePaths || []).some(scope => path === scope || path.startsWith(scope.replace(/\/$/, '') + '/')))
  if (outOfScopePaths.length) issues.push(`代码超出目标任务登记范围：${outOfScopePaths.join('、')}`)
  if (policy) {
    if (!policy.binding?.branch) issues.push('目标版本开发分支尚未绑定；请本人按任务指引 bind，预检不会绑定分支')
    else if (input.branch !== policy.binding.branch) issues.push(`当前分支 ${input.branch || 'detached HEAD'} 与目标分支 ${policy.binding.branch} 不一致；未自动切换分支`)
    if (policy.version?.sealedAt || policy.version?.releasedAt) issues.push('目标版本已封版或发布')
    if (policy.version?.version && policy.version.version !== change.productVersion) issues.push('目标任务与版本策略不一致')
  }
  const rule = snapshot.project.scopePolicy?.rules?.[snapshot.currentUser?.role]?.[policy?.repository]
  const owner = snapshot.currentUser?.userId === snapshot.project.ownerId
  const hotfix = !snapshot.personalProject && change.mode === 'HOTFIX' && change.kind === 'BUG' && change.ownerId === snapshot.currentUser?.userId && !outOfScopePaths.length
  if (rule && !owner && !hotfix) {
    const matches = (path, pattern) => new RegExp('^' + pattern.split('**').map(part => part.split('*').map(text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*') + '$').test(path)
    const denied = input.paths.filter(path => !rule.allow.some(pattern => matches(path, pattern)) || rule.deny.some(pattern => matches(path, pattern)))
    if (denied.length) warnings.push(`代码超出默认角色目录，需要提交完整候选供研发审核：${denied.join('、')}`)
  }
  return { ready: issues.length === 0, problems: issues, warnings, task: { id: change.id, title: change.title, productVersion: change.productVersion }, commit, branch: input.branch, targetBranch: policy?.binding?.branch || null, paths: input.paths, outOfScopePaths, instruction: '此结果仅为只读预检；仍需实际候选审核和提交门禁，不代表审核通过。' }
}
export function branch(cwd) { return git(cwd, 'branch', '--show-current') || process.env.BOOK_COLLABORATION_BRANCH || '' }
export function commitInput(cwd, change, { commit, staged = false, readOnly = false } = {}) {
  if (!staged && !/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('请提供完整 commit SHA')
  if (readOnly && staged) throw new Error('只读预检仅支持已存在的完整提交 SHA')
  const baseCommit = staged ? git(cwd, 'rev-parse', 'HEAD') : git(cwd, 'rev-parse', `${commit}^1`)
  let parents = staged ? [baseCommit] : git(cwd, 'show', '-s', '--format=%P', commit).split(' ')
  const mergeHead = resolve(cwd, git(cwd, 'rev-parse', '--git-path', 'MERGE_HEAD'))
  if (staged && existsSync(mergeHead)) parents = [baseCommit, ...readFileSync(mergeHead, 'utf8').trim().split(/\s+/)]
  if (readOnly && parents.length === 2) throw new Error('只读预检暂不重建合并提交；请单独核对合并协议，未写入 Git 对象或申请审核')
  if (parents.length > 2) throw new Error('不支持多父提交合并，请拆分核对')
  const tree = staged ? git(cwd, 'write-tree') : git(cwd, 'rev-parse', `${commit}^{tree}`)
  const [authorEmail, committerEmail] = staged
    ? [git(cwd, 'var', 'GIT_AUTHOR_IDENT'), git(cwd, 'var', 'GIT_COMMITTER_IDENT')].map(value => value.match(/<([^>]+)>/)?.[1]?.toLowerCase())
    : git(cwd, 'show', '-s', '--format=%ae%x00%ce', commit).toLowerCase().split('\0')
  const merge = parents.length === 2 ? mergeState(cwd, parents, tree) : null
  const paths = merge?.paths || git(cwd, 'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', baseCommit, tree).split('\0').filter(Boolean).sort()
  const patch = git(cwd, '-c', 'core.quotePath=false', 'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--full-index', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', '--unified=3', merge?.automaticTree || baseCommit, tree, ...(merge ? ['--', ...paths] : []))
  if ((!paths.length && !merge) || Buffer.byteLength(patch) > 100000 || /^GIT binary patch$|^Binary files /m.test(patch)) throw new Error('需要 100KB 内的完整文本差异，不能静默省略二进制或文件')
  return { ...(merge ? { merge: { protocol: 1, parents, automaticTree: merge.automaticTree, conflictPaths: merge.conflictPaths } } : {}), origin: origin(cwd), branch: branch(cwd), productVersion: change.productVersion, changeId: change.id, revision: change.revision, baseCommit, tree, paths, patch, authorEmail, committerEmail }
}
