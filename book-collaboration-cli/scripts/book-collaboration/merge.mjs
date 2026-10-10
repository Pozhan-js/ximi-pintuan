import { spawnSync } from 'node:child_process'
import { git } from './local.mjs'

export function mergeState(cwd, parents, tree) {
  if (parents.length !== 2 || parents[0] === parents[1]) throw new Error('合并门禁只支持两个不同的真实父提交')
  const result = spawnSync('git', ['-c', 'merge.conflictStyle=merge', 'merge-tree', '--write-tree', '--name-only', '-z', ...parents], { cwd, encoding: 'utf8', maxBuffer: 2_000_000, timeout: 30000 })
  if (![0, 1].includes(result.status) || result.error) throw new Error('无法重建自动合并树，需要 Git 2.38+')
  const [automaticTree, ...rest] = result.stdout.split('\0')
  if (!/^[a-f0-9]{40}$/.test(automaticTree)) throw new Error('自动合并树无效')
  const conflictPaths = []; for (const path of rest) { if (!path) break; conflictPaths.push(path) }
  const changed = git(cwd, 'diff', '--no-ext-diff', '--no-textconv', '--name-only', '--no-renames', '-z', automaticTree, tree).split('\0').filter(Boolean)
  const blob = (ref, path) => git(cwd, '--literal-pathspecs', 'ls-tree', '-z', ref, '--', path).split('\0')[0].split('\t')[0]
  const paths = [...new Set([...changed, ...conflictPaths])].filter(path => !parents.some(parent => blob(parent, path) === blob(tree, path))).sort()
  return { automaticTree, conflictPaths: [...new Set(conflictPaths)].sort(), paths }
}
