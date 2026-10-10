#!/usr/bin/env node
import { randomBytes, createHash, randomUUID } from 'node:crypto'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { existsSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { synchronizeProject } from './sources.mjs'
import { backupBinding, prepareProjectConfiguration, requirePersonalProject } from './project-config.mjs'
import { readFeishuPrds, versionPrds } from './prds.mjs'
import { call, siteUrl } from './client.mjs'
import { workspace, loadConfig, bindingPath, profileDirectory, privateWrite, readJson, git, origin, branch, commitInput, projectRepository, projectCommitContext, previewCommit } from './local.mjs'

const argv = process.argv.slice(2); const command = argv[0] || 'help'
const flag = name => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined }
const output = data => process.stdout.write(`${JSON.stringify(data, null, 2)}\n`)
async function main() {
  if (command === 'read-prds' && flag('--file')) {
    const manifest = readJson(resolve(flag('--file')))
    if (!Array.isArray(manifest.documents)) throw new Error('登记文件缺少 documents')
    return output({ documents: readFeishuPrds(manifest.documents, flag('--profile')) })
  }
  if (command === 'help') return output({ commands: ['up --site URL --project ID [--switch-project] [--configure-project]', 'down', 'status', 'bind CHG-ID', 'show [CHG-ID] --profile 本人飞书配置', 'read-prds --profile 本人飞书配置 [--file 版本登记.json]', 'task --file JSON', 'progress PHASE --note TEXT', 'preview-commit --commit SHA [--change CHG-ID]', 'prepare-commit [--commit SHA]', 'authorize --staged | --commit SHA', 'verify --commit SHA', 'artifacts --base SHA', 'run-check -- COMMAND ARGS', 'evidence-ci', 'readback --file JSON', 'version-sync', 'sync-sources', 'request ACTION --file JSON', 'install-hooks'], scope: '仅访问配置的 book 站点；不会自动审批、push、merge 或部署' })
  const cwd = workspace(flag('--directory') || process.cwd())
  if (command === 'up') {
    const existing = existsSync(bindingPath(cwd)) ? readJson(bindingPath(cwd)) : {}
    const site = siteUrl(flag('--site') || existing.site)
    const projectId = flag('--project') || existing.projectId
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(projectId || '')) throw new Error('请提供有效项目编号')
    const switching = !!existing.projectId && (existing.projectId !== projectId || existing.site !== site)
    if (switching && !argv.includes('--switch-project')) throw new Error('工作区已关联另一项目；请在独立 worktree 上号，不能覆盖原绑定')
    const directory = profileDirectory(site, projectId, cwd)
    const configPath = join(directory, 'device.json')
    let config = existsSync(configPath) ? readJson(configPath) : { site, projectId, token: randomBytes(32).toString('hex') }
    try { await call(config, 'connection') }
    catch (error) {
      if (error.status && ![401, 403].includes(error.status)) throw error
      if (!error.status) throw error
      config = { site, projectId, token: randomBytes(32).toString('hex') }; privateWrite(configPath, config)
      const hash = createHash('sha256').update(config.token).digest('hex')
      const fragment = new URLSearchParams({ pair: hash, name: flag('--name') || '我的 Codex', issuedAt: String(Date.now()) })
      output({ pairingUrl: `${site}/collaboration/${projectId}#${fragment}`, fingerprint: hash.slice(0, 16).toUpperCase().match(/.{4}/g).join(' '), instruction: '请本人登录网站，核对指纹后点击连接；十分钟内有效。' })
      const deadline = Date.now() + 600000
      let confirmed = false
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 2000))
        try { await call(config, 'connection'); confirmed = true; break } catch (e) { if (![401, 403].includes(e.status)) throw e }
      }
      if (!confirmed) throw new Error('设备确认超时；未上号')
    }
    const snapshot = await call(config, 'snapshot')
    if (snapshot.project?.id !== projectId) throw new Error('目标项目快照与请求编号不一致')
    const repository = projectRepository(cwd, snapshot, site)
    if (argv.includes('--switch-project') || argv.includes('--configure-project')) requirePersonalProject(snapshot)
    const previousDirectory = switching ? profileDirectory(existing.site, existing.projectId, cwd) : null
    const migration = argv.includes('--configure-project') ? prepareProjectConfiguration(cwd, { snapshot, site, repository }) : null
    // Verify the new connection before touching the existing binding or heartbeat.
    const receipt = await call(config, 'device.heartbeat', { changeId: switching ? null : existing.changeId || null })
    if (JSON.stringify(existsSync(bindingPath(cwd)) ? readJson(bindingPath(cwd)) : {}) !== JSON.stringify(existing)) throw new Error('工作区绑定已并发变化，未切换项目')
    privateWrite(configPath, config)
    let configured
    let bindingBackup
    let bindingWritten = false
    const nextBinding = switching ? { site, projectId } : { ...existing, site, projectId }
    try {
      if (switching) bindingBackup = backupBinding(cwd, existing)
      configured = migration?.apply()
      if (JSON.stringify(existsSync(bindingPath(cwd)) ? readJson(bindingPath(cwd)) : {}) !== JSON.stringify(existing)) throw new Error('工作区绑定已并发变化，未切换项目')
      privateWrite(bindingPath(cwd), nextBinding); bindingWritten = true
      const stop = join(directory, 'stop'); if (existsSync(stop)) unlinkSync(stop)
      if (previousDirectory) privateWrite(join(previousDirectory, 'stop'), {})
    } catch (error) {
      const live = existsSync(bindingPath(cwd)) ? readJson(bindingPath(cwd)) : {}
      if (bindingWritten && JSON.stringify(live) === JSON.stringify(nextBinding)) {
        if (existing.projectId) privateWrite(bindingPath(cwd), existing)
        else unlinkSync(bindingPath(cwd))
      }
      const skipped = configured?.rollback() || []
      throw new Error(`${error.message}${configured ? `；配置备份：${configured.directory}` : ''}${skipped.length ? `；并发修改未回退：${skipped.join('、')}` : ''}`)
    }
    const heartbeat = spawn(process.execPath, [fileURLToPath(new URL('./heartbeat.mjs', import.meta.url)), directory, cwd], { detached: true, stdio: 'ignore' }); heartbeat.unref()
    return output({ online: true, ...receipt, projectId, repository: repository.fullName, directory: cwd, ...(bindingBackup ? { bindingBackup } : {}), ...(configured ? { configurationBackup: configured.directory, configuredFiles: configured.paths } : {}) })
  }
  if (command === 'preview-commit' && !/^[a-f0-9]{40}$/.test(flag('--commit') || '')) throw new Error('preview-commit 需要 --commit <完整 SHA>')
  const config = loadConfig(cwd, { readOnly: command === 'preview-commit' })
  if (command === 'down') {
    if (config.directory) writeFileSync(join(config.directory, 'stop'), '', { mode: 0o600 })
    return output(await call(config, 'device.offline'))
  }
  const snapshot = await call(config, 'snapshot')
  if (command === 'read-prds') return output({ productVersion: snapshot.project.productVersion, documents: readFeishuPrds(versionPrds(snapshot), flag('--profile')) })
  if (command === 'sync-sources') {
    const repo = projectRepository(cwd, snapshot, config.site)
    const path = resolve(cwd, git(cwd, 'rev-parse', '--git-path', 'book-collaboration-sources.json'))
    return output(await synchronizeProject({ ...config, workspace: cwd, repository: repo.id, fullName: repo.fullName, currentVersion: snapshot.project.productVersion }, call, async () => existsSync(path) ? readJson(path) : {}, async receipt => privateWrite(path, receipt)))
  }
  if (command === 'status') return output({ project: snapshot.project.name, currentUser: snapshot.currentUser, devices: snapshot.devices.filter(d => d.userId === snapshot.currentUser.userId), changeId: config.changeId || null })
  const id = command === 'bind' || command === 'show' ? argv[1] || config.changeId : flag('--change') || config.changeId || process.env.BOOK_COLLABORATION_CHANGE
  const change = (snapshot.changes || []).find(c => c.id === id)
  const requireChange = () => { if (!change) throw new Error('请先 bind 一个本人可处理的任务'); return change }
  const fileBody = () => { const file = flag('--file'); if (!file) throw new Error('需要 --file JSON'); return readJson(resolve(file)) }
  if (command === 'preview-commit') {
    const commit = flag('--commit')
    const problems = []
    try { projectCommitContext(cwd, snapshot, config.site) } catch (error) { problems.push(error.message) }
    if (!change) problems.push('请指定本人可处理的任务 --change <CHG-ID>，或先核对已有任务绑定')
    if (problems.length) return output({ ready: false, problems, task: change ? { id: change.id, title: change.title, productVersion: change.productVersion } : null, commit })
    let input
    try { input = commitInput(cwd, change, { commit, readOnly: true }) }
    catch (error) { return output({ ready: false, problems: [error.message], task: { id: change.id, title: change.title, productVersion: change.productVersion }, commit }) }
    let policy
    try { policy = await call(config, 'version.policy', { changeId: change.id, origin: input.origin, branch: input.branch }) }
    catch (error) { problems.push(`目标版本策略未就绪：${error.message}`) }
    return output(previewCommit(input, snapshot, change, policy, commit, problems))
  }
  if (['bind', 'prepare-commit', 'authorize', 'verify', 'artifacts', 'run-check', 'evidence-ci', 'version-sync'].includes(command)) projectCommitContext(cwd, snapshot, config.site, { learnerDevelopment: !['verify', 'evidence-ci', 'version-sync'].includes(command) })
  if (command === 'bind') {
    requireChange()
    const productDocuments = readFeishuPrds(versionPrds(snapshot), flag('--profile'))
    await call(config, 'device.heartbeat', { changeId: change.id })
    const policy = await call(config, 'version.join', { changeId: change.id, origin: origin(cwd), branch: branch(cwd) })
    if (policy.binding?.branch !== branch(cwd)) throw new Error(`需在绑定分支 ${policy.binding?.branch} 工作；未自动切换分支`)
    privateWrite(bindingPath(cwd), { site: config.site, projectId: config.projectId, changeId: change.id })
    return output({ bound: change.id, branch: policy.binding.branch, productDocuments })
  }
  if (command === 'show') return output({ ...requireChange(), productDocuments: readFeishuPrds([...versionPrds(snapshot), ...change.documents], flag('--profile')) })
  if (command === 'task') return output(await call(config, 'task.upsert', fileBody()))
  if (command === 'progress') return output(await call(config, 'change.progress', { changeId: requireChange().id, revision: change.revision, phase: argv[1], handoff: flag('--note') || '' }))
  if (command === 'readback') return output(await call(config, 'readback.propose', { ...fileBody(), changeId: requireChange().id, revision: change.revision, contentHash: change.contentHash }))
  if (['prepare-commit', 'authorize', 'verify'].includes(command)) {
    const commit = flag('--commit') || (argv.includes('--staged') || command === 'prepare-commit' ? undefined : git(cwd, 'rev-parse', 'HEAD'))
    const input = commitInput(cwd, requireChange(), { commit, staged: !commit })
    return output(await call(config, command === 'prepare-commit' ? 'commit.prepare' : command === 'authorize' ? 'commit.authorize' : 'commit.check', { ...input, reviewStage: argv.includes('--staged') ? 'COMMIT' : 'PUSH' }))
  }
  if (command === 'artifacts') {
    requireChange()
    if (git(cwd, 'status', '--porcelain')) throw new Error('工作区必须干净才能登记实际交付提交')
    const base = flag('--base'); if (!base || !/^[a-f0-9]{40}$/.test(base)) throw new Error('请提供已核对的完整基线 SHA')
    const commit = git(cwd, 'rev-parse', 'HEAD'); git(cwd, 'merge-base', '--is-ancestor', base, commit)
    const policy = await call(config, 'version.policy', { changeId: change.id, origin: origin(cwd), branch: branch(cwd) })
    const paths = git(cwd, 'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', base, commit).split('\0').filter(Boolean)
    const candidate = commitInput(cwd, change, { commit })
    return output(await call(config, 'change.artifacts', { changeId: change.id, revision: change.revision, artifacts: [{ repository: policy.repository, branch: branch(cwd), commit, paths }], commitProof: { ...candidate, object: execFileSync('git', ['cat-file', 'commit', commit], { cwd, maxBuffer: 100000 }).toString('base64') } }))
  }
  if (command === 'run-check' || command === 'evidence-ci') {
    requireChange()
    const head = git(cwd, 'rev-parse', 'HEAD')
    if (git(cwd, 'status', '--porcelain') || !change.artifacts.some(a => a.commit === head)) throw new Error('检查必须覆盖已登记的干净候选提交')
    let passed = true; let name = 'GitHub required checks'
    if (command === 'run-check') {
      const split = argv.indexOf('--'); const args = split >= 0 ? argv.slice(split + 1) : []
      if (!args.length) throw new Error('需要 -- 后的真实检查命令与参数')
      const result = spawnSync(args[0], args.slice(1), { cwd, stdio: 'inherit', timeout: 600000 }); passed = result.status === 0 && !result.error; name = args.join(' ').slice(0, 160)
      if (git(cwd, 'rev-parse', 'HEAD') !== head || git(cwd, 'status', '--porcelain')) throw new Error('检查期间工作区发生变化，不上报结果')
    }
    const evidence = await call(config, 'evidence.submit', { changeId: change.id, revision: change.revision, contentHash: change.contentHash, artifactDigest: change.artifactDigest, source: command === 'evidence-ci' ? 'CI' : 'LOCAL', result: passed ? 'PASSED' : 'FAILED', checks: [{ name, passed }], repositories: change.artifacts.filter(a => a.commit === head).map(a => a.repository), reference: command === 'evidence-ci' ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : `local:${head}`, runId: randomUUID() })
    output(evidence)
    if (!passed || evidence.evidence?.at(-1)?.result === 'FAILED') process.exitCode = 1
    return
  }
  if (command === 'version-sync') {
    const version = snapshot.project.versions.find(v => v.version === snapshot.project.productVersion)
    if (!version?.delivery) throw new Error('管理员尚未登记版本交付目标')
    const policy = await call(config, 'version.policy', { origin: origin(cwd), branch: branch(cwd) })
    const target = version.delivery.targets.find(t => t.repository === policy.repository)
    if (!target) throw new Error('此仓库不是版本交付目标')
    return output(await call(config, 'version.merge', { productVersion: version.version, deliveryId: version.delivery.id, repository: policy.repository, origin: origin(cwd), commit: target.commit }))
  }
  if (command === 'request') return output(await call(config, argv[1], fileBody()))
  if (command === 'install-hooks') {
    const custom = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd, encoding: 'utf8' })
    if (custom.status === 0 && custom.stdout.trim()) throw new Error('已有自定义 hooksPath，请按接入文档将门禁加入原 Hook')
    const hook = fileURLToPath(new URL('./hook.mjs', import.meta.url))
    const files = ['pre-commit', 'pre-push'].map(name => ({ name, path: resolve(cwd, git(cwd, 'rev-parse', '--git-path', `hooks/${name}`)) }))
    if (files.some(f => existsSync(f.path))) throw new Error('已有 Git Hook；未覆盖，请把 book 门禁接入现有 Hook')
    for (const file of files) writeFileSync(file.path, `#!/usr/bin/env node\n// book-collaboration managed hook\nimport(${JSON.stringify(pathToFileURL(hook).href)});\n`, { mode: 0o700, flag: 'wx' })
    // Hook selects mode from argv[1] (its installed filename).
    return output({ installed: files.map(f => f.name) })
  }
  throw new Error('未知命令，请运行 help')
}
main().catch(error => { process.stderr.write(`${error.message || '执行失败'}\n`); process.exitCode = 1 })
