#!/usr/bin/env node
import { call } from './client.mjs'
import { loadConfig, workspace, git, commitInput, origin, branch } from './local.mjs'

try {
  const cwd = workspace(); const config = loadConfig(cwd); const snapshot = await call(config, 'snapshot')
  const mapping = JSON.parse(process.env.BOOK_COLLABORATION_CHANGE_MAP || '{}')
  const head = git(cwd, 'rev-parse', 'HEAD')
  if (head !== process.env.GITHUB_SHA || git(cwd, 'status', '--porcelain')) throw new Error('CI checkout 必须干净且与事件 SHA 一致')
  const mainRepo = snapshot.project.integrations?.repositories.find(r => r.fullName.toLowerCase() === origin(cwd).replace(/^git@github\.com:|^https:\/\/github\.com\//, '').replace(/\.git$/, '').toLowerCase())
  if (!mainRepo) throw new Error('CI 仓库未登记')
  const base = git(cwd, 'merge-base', `origin/${mainRepo.defaultBranch}`, head)
  const commits = git(cwd, 'rev-list', '--reverse', `${base}..${head}`).split('\n').filter(Boolean)
  if (!commits.length) throw new Error('CI 未找到待核对的开发提交')
  for (const commit of commits) {
    const explicit = mapping[commit] || process.env.BOOK_COLLABORATION_CHANGE
    const taskCandidates = snapshot.changes.filter(c => explicit ? c.id === explicit : (c.explorationBranch || snapshot.project.versions?.find(v => v.version === c.productVersion)?.branches[mainRepo.id]?.branch) === branch(cwd))
    const matching = taskCandidates.map(change => ({ change, input: commitInput(cwd, change, { commit }) })).filter(({ change, input }) => !input.paths.length || change.commitCandidates?.some(c => c.tree === input.tree && c.baseCommit === input.baseCommit && c.repository === mainRepo.id) || (snapshot.project.members.find(m => m.userId === change.ownerId)?.verifiedEmail === input.authorEmail && input.paths.every(p => change.scopePaths.some(s => p === s || p.startsWith(s.replace(/\/$/, '') + '/')))))
    if (matching.length && !matching[0].input.paths.length) continue // automatic merge adds no manual changes
    if (matching.length !== 1) throw new Error(`提交 ${commit} 无法唯一关联任务；请管理员配置精确 SHA 到任务的 BOOK_COLLABORATION_CHANGE_MAP`)
    await call(config, 'commit.check', { ...matching[0].input, reviewStage: 'PUSH' })
  }
  process.stdout.write('已复核当前提交、本人授权回执、任务范围和审核；不代表验收或发布完成。\n')
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
