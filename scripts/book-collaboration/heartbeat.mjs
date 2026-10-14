import { existsSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { call } from './client.mjs'
import { bindingPath, readJson } from './local.mjs'
import { createTemplateUpdater } from './updates.mjs'
import { createBootstrap } from './bootstrap.mjs'

const [directory, cwd] = process.argv.slice(2)
const lock = join(directory, 'heartbeat.lock')
// Resolve Git's per-worktree path once; reread the binding itself every heartbeat.
const bindingFile = bindingPath(cwd)
let updater
let handle
try { handle = openSync(lock, 'wx', 0o600) } catch {
  const previous = readFileSync(lock, 'utf8')
  if (!/^[1-9]\d*$/.test(previous)) process.exit(1)
  try { process.kill(Number(previous), 0); process.exit(0) } catch (error) { if (error.code !== 'ESRCH') process.exit(1) }
  // Only recover a dead worker's unchanged lock. Never terminate another process.
  if (readFileSync(lock, 'utf8') !== previous) process.exit(0)
  unlinkSync(lock)
  try { handle = openSync(lock, 'wx', 0o600) } catch { process.exit(0) }
}
writeFileSync(handle, String(process.pid)); closeSync(handle)
const releaseLock = () => {
  if (existsSync(lock) && readFileSync(lock, 'utf8') === String(process.pid)) unlinkSync(lock)
}
// Also notice stop during a slow network request. Only this worker exits; no PID killing.
const stopWatcher = setInterval(() => {
  if (existsSync(join(directory, 'stop'))) { releaseLock(); process.exit(0) }
}, 1_000)
try {
  while (!existsSync(join(directory, 'stop'))) {
    try {
      const config = readJson(join(directory, 'device.json'))
      const binding = readJson(bindingFile)
      if (config.site !== binding.site || config.projectId !== binding.projectId) break
      updater ||= createTemplateUpdater(cwd, config, { metadataDirectory: dirname(bindingFile) })
      const receipt = await call(config, 'device.heartbeat', { changeId: binding.changeId || null, ...updater.report() })
      createBootstrap(cwd, { ...config, directory }).acceptStatus(receipt)
      if ('templateUpdates' in receipt) updater.acceptPolicy(receipt.templateUpdates)
      writeFileSync(join(directory, 'heartbeat-status.json'), JSON.stringify({ online: true, at: new Date().toISOString(), pid: process.pid, templateUpdate: updater.status() }), { mode: 0o600 })
    } catch (error) {
      writeFileSync(join(directory, 'heartbeat-status.json'), JSON.stringify({ online: false, at: new Date().toISOString(), pid: process.pid }), { mode: 0o600 })
      if ([401, 403].includes(error.status)) break
    }
    for (let second = 0; second < 15 && !existsSync(join(directory, 'stop')); second++) {
      await new Promise(resolve => setTimeout(resolve, 1_000))
    }
  }
} finally {
  clearInterval(stopWatcher)
  releaseLock()
}
