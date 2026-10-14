#!/usr/bin/env node
import { randomBytes, createHash, randomUUID } from 'node:crypto'
import { spawnSync, execFileSync } from 'node:child_process'
import { existsSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { synchronizeProject } from './sources.mjs'
import { backupBinding, prepareProjectConfiguration, requirePersonalProject } from './project-config.mjs'
import { readFeishuPrds, versionPrds } from './prds.mjs'
import { call, siteUrl } from './client.mjs'
import { collectVercelSetup } from './vercel-setup.mjs'
import { workspace, loadConfig, bindingPath, profileDirectory, privateWrite, readJson, git, origin, branch, commitInput, projectRepository, projectCommitContext, previewCommit } from './local.mjs'
import { startHeartbeat, stopHeartbeat, heartbeatIsRunning } from './heartbeat-process.mjs'
import { createTemplateUpdater } from './updates.mjs'
import { installTemplateHook } from './install-update-hook.mjs'
import { createBootstrap, readUpgradeRules } from './bootstrap.mjs'

const argv = process.argv.slice(2); const command = argv[0] || 'help'
const flag = name => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined }
const output = data => process.stdout.write(`${JSON.stringify(data, null, 2)}\n`)
async function main() {
  if ((command === 'help' && argv[1] === 'readback') || (command === 'readback' && argv.includes('--help'))) return output({
    usage: 'readback --file 验收说明.json [--change CHG-ID]',
    purpose: '提交实际实现、验证依据和已知差异；也可在任务网页点击“提交验收说明”。',
    example: { summary: '说明实际完成的内容、对应验收条目与证据链接，并如实列出未完成项。', documents: [], items: [] },
    required: {
      summary: '非空文字，最多 8000 字符；安装、运行、测试、预览等结果应注明对应提交和证据。',
      documents: '任务未关联文档时填 []；有关联文档时逐份填写真实 url 和当前数字字符串 revision，不能把历史基线当成当前版本。',
      items: '最多 100 项；核对后确认无已知差异时填 []，不省略该字段。',
    },
    differenceExample: { fact: '实际实现及代码位置', expected: '任务或产品要求及位置', suggestion: '建议怎样处理这项差异' },
    documentExample: { url: '/collaboration/项目编号/documents/文档编号', revision: '2' },
    automatic: ['changeId', 'revision', 'contentHash', '差异 id'],
    reviewerOnly: 'PRD / CODE / TECH 是产品负责人的判定值，不由学员预填；suggestion 是自由文本。',
    next: '提交后在任务详情查看验收说明；指定负责人逐项判定。个人作业中教师同时负责产品确认时，可“确认验收说明并完成作业”。',
    limitations: '平台无法核验关联文档时会拒绝提交；本人 CLI 读到正文不代表平台已核验飞书版本，请联系项目负责人处理。',
  })
  if (command === 'read-prds' && flag('--file')) {
    const manifest = readJson(resolve(flag('--file')))
    if (!Array.isArray(manifest.documents)) throw new Error('登记文件缺少 documents')
    return output({ documents: readFeishuPrds(manifest.documents, flag('--profile')) })
  }
  if (command === 'help') return output({ commands: ['up --site URL --project ID [--switch-project] [--configure-project]', 'down', 'status', 'upgrade-status', 'read-upgrade-rules', 'complete-upgrade --rules-read', 'check-updates', 'configure-updates --file 本人可信来源及基线.json', 'sync-updates', 'recover-updates --file 恢复.json', 'read-updates --path 管理文件', 'ack-updates --revision 模板版本', 'install-update-hook', 'vercel-submit [--file 公开配置.json] [--vercel-directory PATH]', 'bind CHG-ID', 'show [CHG-ID] --profile 本人飞书配置', 'read-prds --profile 本人飞书配置 [--file 版本登记.json]', 'task --file JSON', 'progress PHASE --note TEXT', 'preview-commit --commit SHA [--change CHG-ID]', 'prepare-commit [--commit SHA]', 'authorize --staged | --commit SHA', 'verify --commit SHA', 'artifacts --base SHA', 'run-check -- COMMAND ARGS', 'evidence-ci', 'readback --file JSON', 'version-sync', 'sync-sources', 'request ACTION --file JSON', 'install-hooks'], scope: '仅访问配置的 book 站点与本人已接入的可信模板来源；不会自动审批、提交、push、merge 或部署' })
  const cwd = workspace(flag('--directory') || process.cwd())
  if (command === 'read-upgrade-rules') {
    if (argv.length !== 1) throw new Error('read-upgrade-rules 只读取固定规则，不接受 --path 或其他参数')
    const result = readUpgradeRules(cwd)
    let config
    try { config = loadConfig(cwd, { readOnly: true }) } catch {}
    if (!config || !/^[a-f0-9]{64}$/.test(config.token || '')) return output({ ...result, rulesReadEvidenceRecorded: false, instruction: '尚未连接；本次仅阅读规则，连接后请再次回读以生成本人确认凭据' })
    const rulesReadEvidence = createBootstrap(cwd, config).recordRulesRead(result)
    return output({ ...result, rulesReadEvidenceRecorded: true, rulesReadEvidence })
  }
  if (command === 'install-update-hook') return output(installTemplateHook(cwd))
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
      const fragment = new URLSearchParams({ pair: hash, name: flag('--name') || '我的 AI 工具', issuedAt: String(Date.now()) })
      output({ pairingUrl: `${site}/collaboration/${projectId}#${fragment}`, fingerprint: hash.slice(0, 16).toUpperCase().match(/.{4}/g).join(' '), instruction: '请本人登录网站，核对当前 AI 工具的指纹后点击连接；十分钟内有效。' })
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
    const updater = createTemplateUpdater(cwd, config)
    updater.assertIdle()
    const receipt = await call(config, 'device.heartbeat', { changeId: switching ? null : existing.changeId || null, ...updater.report() })
    createBootstrap(cwd, { ...config, directory }).acceptStatus(receipt)
    if ('templateUpdates' in receipt) updater.acceptPolicy(receipt.templateUpdates)
    if (JSON.stringify(existsSync(bindingPath(cwd)) ? readJson(bindingPath(cwd)) : {}) !== JSON.stringify(existing)) throw new Error('工作区绑定已并发变化，未切换项目')
    privateWrite(configPath, config)
    let configured
    let bindingBackup
    let bindingWritten = false
    let previousHeartbeatStopped = false
    const previousHeartbeatRunning = previousDirectory && heartbeatIsRunning(previousDirectory)
    const nextBinding = switching ? { site, projectId } : { ...existing, site, projectId }
    try {
      if (switching) bindingBackup = backupBinding(cwd, existing)
      configured = migration?.apply()
      if (JSON.stringify(existsSync(bindingPath(cwd)) ? readJson(bindingPath(cwd)) : {}) !== JSON.stringify(existing)) throw new Error('工作区绑定已并发变化，未切换项目')
      privateWrite(bindingPath(cwd), nextBinding); bindingWritten = true
      if (previousDirectory) { await stopHeartbeat(previousDirectory); previousHeartbeatStopped = true }
      const heartbeat = await startHeartbeat(directory, cwd)
      return output({ online: true, ...receipt, projectId, repository: repository.fullName, heartbeat: { pid: heartbeat.pid, at: heartbeat.at }, templateUpdate: updater.status(), directory: cwd, ...(bindingBackup ? { bindingBackup } : {}), ...(configured ? { configurationBackup: configured.directory, configuredFiles: configured.paths } : {}) })
    } catch (error) {
      const recoveryErrors = []
      let bindingRestored = false
      try {
        const live = existsSync(bindingPath(cwd)) ? readJson(bindingPath(cwd)) : {}
        if (bindingWritten && JSON.stringify(live) === JSON.stringify(nextBinding)) {
          if (existing.projectId) privateWrite(bindingPath(cwd), existing)
          else unlinkSync(bindingPath(cwd))
          bindingRestored = true
        }
      } catch (restoreError) { recoveryErrors.push(`绑定恢复失败：${restoreError.message}`) }
      let skipped = []
      try { skipped = configured?.rollback() || [] }
      catch (restoreError) { recoveryErrors.push(`配置恢复失败：${restoreError.message}`) }
      // A failed switch must restore the old session as well as its files. Never
      // start an old session if the learner was offline or another writer changed binding.
      if (bindingRestored && previousHeartbeatStopped && previousHeartbeatRunning) {
        try { await startHeartbeat(previousDirectory, cwd) }
        catch (restoreError) { recoveryErrors.push(`旧项目心跳未恢复，请重新 up：${restoreError.message}`) }
      }
      throw new Error(`${error.message}${configured?.directory ? `；配置备份：${configured.directory}` : ''}${skipped.length ? `；并发修改未回退：${skipped.join('、')}` : ''}${recoveryErrors.length ? `；${recoveryErrors.join('；')}` : ''}`)
    }
  }
  if (command === 'preview-commit' && !/^[a-f0-9]{40}$/.test(flag('--commit') || '')) throw new Error('preview-commit 需要 --commit <完整 SHA>')
  const config = loadConfig(cwd, { readOnly: command === 'preview-commit' })
  if (command === 'upgrade-status') { const receipt = await call(config, 'connection.upgrade.status'); createBootstrap(cwd, config).acceptStatus(receipt); return output(receipt) }
  if (command === 'complete-upgrade') {
    if (!argv.includes('--rules-read')) throw new Error('请先用当前 AI 工具运行 read-upgrade-rules 回读规则，再提供 --rules-read')
    const connection = await call(config, 'connection')
    if (connection.kind !== 'CODEX') throw new Error('升级确认仅适用于本人 AI 工具连接')
    const bootstrap = createBootstrap(cwd, config), evidence = bootstrap.evidence()
    await call(config, 'device.heartbeat', { changeId: config.changeId || null })
    const confirmed = await call(config, 'connection.upgrade.confirm', evidence)
    bootstrap.acceptStatus(confirmed)
    const receipt = await call(config, 'device.heartbeat', { changeId: config.changeId || null })
    bootstrap.acceptStatus(receipt)
    if (receipt.connectionUpgradeTask?.status === 'COMPLETE') bootstrap.assertReady()
    return output({ connectionUpgradeTask: receipt.connectionUpgradeTask, confirmation: confirmed.connectionUpgradeTask, rulesReadEvidence: evidence.rulesReadEvidence, instruction: '已提交当前客户端的真实规则回读证据；以服务器在确认后收到匹配心跳的任务状态为准。' })
  }
  if (command === 'down') {
    if (config.directory) await stopHeartbeat(config.directory)
    return output(await call(config, 'device.offline'))
  }
  // Only a server-authenticated connection can identify CI. Personal template
  // availability must not block CI evidence, and preview remains read-only.
  const connection = command === 'preview-commit' ? null : await call(config, 'connection')
  const updater = command === 'preview-commit' || connection?.kind === 'CI' ? null : createTemplateUpdater(cwd, config)
  const bootstrap = updater ? createBootstrap(cwd, config) : null
  const updateCommands = new Set(['check-updates', 'configure-updates', 'sync-updates', 'recover-updates', 'read-updates', 'ack-updates'])
  if (!updater && updateCommands.has(command)) throw new Error('CI 连接不适用个人模板同步命令；请使用本人 AI 工具连接')
  const guarded = new Set(['bind', 'task', 'progress', 'prepare-commit', 'authorize', 'artifacts', 'run-check', 'evidence-ci', 'readback', 'version-sync'])
  const guardedRequests = new Set(['learning.claim', 'task.upsert', 'version.join', 'bind', 'change.progress', 'commit.prepare', 'commit.authorize', 'change.artifacts', 'evidence.submit', 'readback.propose', 'readback.confirm'])
  if (guarded.has(command) || (command === 'request' && guardedRequests.has(argv[1]))) {
    if (connection.kind !== 'CI') {
      const upgrade = await call(config, 'connection.upgrade.status')
      bootstrap.acceptStatus(upgrade)
      bootstrap.assertReady()
    }
  }
  let templatePolicyError
  if (updater) {
    try {
      const policy = await call(config, 'template.policy')
      if ('updates' in policy) updater.acceptPolicy(policy.updates)
      else throw new Error(policy.templatePolicyError || '模板策略暂时不可读；保留之前缓存')
    } catch (error) {
      if (!['status', 'show'].includes(command)) throw error
      templatePolicyError = error.message
    }
  }
  if (command === 'check-updates') return output(updater.status())
  if (command === 'configure-updates') {
    if (!flag('--file')) throw new Error('需要本人核对的可信来源、范围和旧版基线配置 --file JSON')
    return output(updater.configure(readJson(resolve(flag('--file')))))
  }
  if (command === 'sync-updates') return output(await updater.sync())
  if (command === 'recover-updates') {
    if (!flag('--file')) throw new Error('需要核对后的恢复文本 --file JSON')
    return output(await updater.recover(readJson(resolve(flag('--file')))))
  }
  if (command === 'read-updates') return output(updater.read(flag('--path')))
  if (command === 'ack-updates') {
    const receipt = updater.acknowledge(Number(flag('--revision')))
    const heartbeat = await call(config, 'device.heartbeat', { changeId: config.changeId || null, ...updater.report() })
    if ('templateUpdates' in heartbeat) updater.acceptPolicy(heartbeat.templateUpdates)
    updater.assertReady()
    return output({ ...receipt, receivedAt: heartbeat.receivedAt })
  }
  if (guarded.has(command) || (command === 'request' && guardedRequests.has(argv[1]))) updater?.assertReady()
  const snapshot = await call(config, 'snapshot')
  if (bootstrap) bootstrap.acceptStatus(snapshot)
  if (command === 'read-prds') return output({ productVersion: snapshot.project.productVersion, documents: readFeishuPrds(versionPrds(snapshot), flag('--profile')) })
  if (command === 'sync-sources') {
    const repo = projectRepository(cwd, snapshot, config.site)
    const path = resolve(cwd, git(cwd, 'rev-parse', '--git-path', 'book-collaboration-sources.json'))
    return output(await synchronizeProject({ ...config, workspace: cwd, repository: repo.id, fullName: repo.fullName, currentVersion: snapshot.project.productVersion }, call, async () => existsSync(path) ? readJson(path) : {}, async receipt => privateWrite(path, receipt)))
  }
  if (command === 'status') return output({ project: snapshot.project.name, currentUser: snapshot.currentUser, devices: snapshot.devices.filter(d => d.userId === snapshot.currentUser.userId), changeId: config.changeId || null, connectionUpgradeTask: snapshot.connectionUpgradeTask || null, connectionUpgradeApplicable: snapshot.connectionUpgradeApplicable ?? null, templatePolicyError: snapshot.templatePolicyError || templatePolicyError || null, templateUpdate: updater?.status() || { status: 'NOT_APPLICABLE', connectionKind: connection.kind } })
  if (command === 'vercel-submit') {
    const input = flag('--file') ? readJson(resolve(flag('--file'))) : {}
    const configuration = collectVercelSetup(cwd, snapshot, input, flag('--vercel-directory') || '.')
    return output(await call(config, 'vercel.setup.submit', { configuration, ...(typeof input.requestId === 'string' ? { requestId: input.requestId } : {}) }))
  }
  const id = command === 'bind' || command === 'show' ? argv[1] || config.changeId : flag('--change') || config.changeId || process.env.BOOK_COLLABORATION_CHANGE
  const change = (snapshot.changes || []).find(c => c.id === id)
  const requireChange = () => { if (!change) throw new Error('请先 bind 一个本人可处理的任务'); return change }
  const fileBody = () => { const file = flag('--file'); if (!file) throw new Error('需要 --file JSON'); return readJson(resolve(file)) }
  if (command === 'preview-commit') {
    const commit = flag('--commit')
    const problems = []
    if (snapshot.connectionUpgradeTask && snapshot.connectionUpgradeTask.status !== 'COMPLETE') problems.push('请先完成升级连接工具前置任务')
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
    if (updater) await call(config, 'device.heartbeat', { changeId: change.id, ...updater.report() })
    const policy = await call(config, 'version.join', { changeId: change.id, origin: origin(cwd), branch: branch(cwd) })
    if (policy.binding?.branch !== branch(cwd)) throw new Error(`需在绑定分支 ${policy.binding?.branch} 工作；未自动切换分支`)
    privateWrite(bindingPath(cwd), { site: config.site, projectId: config.projectId, changeId: change.id })
    return output({ bound: change.id, branch: policy.binding.branch, productDocuments })
  }
  if (command === 'show') {
    const pending = snapshot.connectionUpgradeTask && snapshot.connectionUpgradeTask.status !== 'COMPLETE'
    return output({ ...requireChange(), connectionUpgradeTask: snapshot.connectionUpgradeTask || null, connectionUpgradeApplicable: snapshot.connectionUpgradeApplicable ?? null, templatePolicyError: snapshot.templatePolicyError || templatePolicyError || null, prerequisiteInstruction: pending ? '请先完成升级连接工具前置任务；原作业保留，正式接手后仍需回读产品文档' : null, productDocuments: pending ? [] : readFeishuPrds([...versionPrds(snapshot), ...(change.documents || [])], flag('--profile')), productDocumentsRead: !pending })
  }
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
    return output(await call(config, 'change.artifacts', { changeId: change.id, revision: change.revision, artifacts: [{ repository: policy.repository, branch: branch(cwd), commit, paths }], commitProof: { ...candidate, object: execFileSync('git', ['cat-file', 'commit', commit], { cwd, windowsHide: true, maxBuffer: 100000 }).toString('base64') } }))
  }
  if (command === 'run-check' || command === 'evidence-ci') {
    requireChange()
    const head = git(cwd, 'rev-parse', 'HEAD')
    if (git(cwd, 'status', '--porcelain') || !change.artifacts.some(a => a.commit === head)) throw new Error('检查必须覆盖已登记的干净候选提交')
    let passed = true; let name = 'GitHub required checks'
    if (command === 'run-check') {
      const split = argv.indexOf('--'); const args = split >= 0 ? argv.slice(split + 1) : []
      if (!args.length) throw new Error('需要 -- 后的真实检查命令与参数')
      const result = spawnSync(args[0], args.slice(1), { cwd, windowsHide: true, stdio: 'inherit', timeout: 600000 }); passed = result.status === 0 && !result.error; name = args.join(' ').slice(0, 160)
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
    const custom = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd, windowsHide: true, encoding: 'utf8' })
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
