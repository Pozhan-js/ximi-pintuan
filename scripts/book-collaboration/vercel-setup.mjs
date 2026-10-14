import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { resolve, relative, isAbsolute } from 'node:path'
import { branch, origin } from './local.mjs'

/** Extract only public metadata; never transmit .vercel contents or a Git URL. */
export function githubRepository(remote) {
  const scp = remote.match(/^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i)
  if (scp) return `${scp[1]}/${scp[2]}`
  try {
    const url = new URL(remote)
    if (url.hostname.toLowerCase() !== 'github.com' || !['https:', 'ssh:'].includes(url.protocol) || url.search || url.hash) throw new Error()
    const path = url.pathname.replace(/^\//, '').replace(/\.git$/, '')
    if (!/^[\w.-]+\/[\w.-]+$/.test(path)) throw new Error()
    return path
  } catch { throw new Error('请在本人的 GitHub 实战仓库中采集部署配置') }
}

export function collectVercelSetup(cwd, snapshot, overrides = {}, vercelDirectory = '.') {
  if (snapshot.personalProject?.learnerId !== snapshot.currentUser?.userId) throw new Error('请连接本人的个人实战项目后提交部署配置')
  const repositories = snapshot.project?.integrations?.repositories || []
  if (repositories.length !== 1 || repositories[0].id !== 'web' || repositories[0].reviewOnly) throw new Error('目前仅支持个人实战的单个主仓库')
  const fullName = githubRepository(origin(cwd))
  const currentBranch = branch(cwd)
  const expected = snapshot.project.versions?.find(item => item.version === snapshot.project.productVersion)?.branches.web?.branch
  if (fullName.toLowerCase() !== repositories[0].fullName.toLowerCase() || !expected || currentBranch !== expected)
    throw new Error('当前 Git 仓库或分支与课程登记不一致，请先核对连接和开发分支')
  const root = realpathSync(cwd)
  const directory = resolve(root, vercelDirectory)
  const file = resolve(directory, '.vercel/project.json')
  const fileIsInside = path => { const suffix = relative(root, path); return suffix !== '..' && !suffix.startsWith('../') && !isAbsolute(suffix) }
  if (!fileIsInside(directory)) throw new Error('Vercel 配置目录须位于当前实战仓库内')
  let linked = {}
  if (existsSync(file)) {
    if (!fileIsInside(realpathSync(file))) throw new Error('Vercel 配置文件指向仓库外，未采集')
    try { linked = JSON.parse(readFileSync(file, 'utf8')) } catch { throw new Error('本地 Vercel 项目配置不是有效 JSON，请核对后重试') }
  }
  const input = overrides.configuration || overrides
  const settings = linked.settings || {}
  const field = (key, fallback) => Object.hasOwn(input, key) ? input[key] : fallback
  const projectId = field('projectId', linked.projectId)
  const teamId = field('teamId', typeof linked.orgId === 'string' && linked.orgId.startsWith('team_') ? linked.orgId : '')
  if (typeof projectId !== 'string' || !/^prj_[\w-]{1,96}$/.test(projectId) || typeof teamId !== 'string' || (teamId && !/^team_[\w-]{1,95}$/.test(teamId)))
    throw new Error('请提供原始 Project ID 和 Team ID，或在本仓库连接 Vercel 后再采集；保留 0/O 与大小写')
  return { repository: 'web', fullName, branch: currentBranch, projectId, teamId,
    projectName: field('projectName', linked.projectName || ''), rootDirectory: field('rootDirectory', settings.rootDirectory || ''),
    buildCommand: field('buildCommand', settings.buildCommand ?? null), installCommand: field('installCommand', settings.installCommand ?? null) }
}
