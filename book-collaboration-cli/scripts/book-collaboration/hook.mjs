#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { call } from './client.mjs'
import { workspace, loadConfig, git, origin, branch, commitInput } from './local.mjs'

try {
  const cwd = workspace(); const config = loadConfig(cwd); const snapshot = await call(config, 'snapshot')
  const change = snapshot.changes.find(c => c.id === config.changeId)
  if (!change) throw new Error('工作区没有绑定任务；提交门禁保持阻断')
  if (process.argv[1].endsWith('pre-commit') || process.argv[2] === 'pre-commit') {
    const input = commitInput(cwd, change, { staged: true })
    if (input.paths.length) await call(config, 'commit.authorize', { ...input, reviewStage: 'COMMIT' })
  } else {
    const policy = await call(config, 'version.policy', { changeId: change.id, origin: origin(cwd), branch: branch(cwd) })
    const repo = snapshot.project.integrations?.repositories.find(r => r.id === policy.repository)
    if (!repo) throw new Error('仓库没有登记')
    for (const line of readFileSync(0, 'utf8').trim().split('\n').filter(Boolean)) {
      const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/)
      if (/^0+$/.test(localSha) || remoteRef !== `refs/heads/${policy.binding?.branch}` || localRef !== `refs/heads/${branch(cwd)}`) throw new Error('门禁只允许本人绑定的开发分支；不允许删除或推送到其他分支')
      git(cwd, 'fetch', '--no-tags', 'origin', repo.defaultBranch)
      const base = /^0+$/.test(remoteSha) ? git(cwd, 'merge-base', `origin/${repo.defaultBranch}`, localSha) : remoteSha
      git(cwd, 'merge-base', '--is-ancestor', base, localSha)
      const commits = git(cwd, 'rev-list', '--reverse', `${base}..${localSha}`).split('\n').filter(Boolean)
      for (const commit of commits) { const input = commitInput(cwd, change, { commit }); if (input.paths.length) await call(config, 'commit.authorize', { ...input, reviewStage: 'PUSH' }) }
    }
  }
} catch (error) { process.stderr.write(`Book 协作门禁：${error.message}\n`); process.exitCode = 1 }
