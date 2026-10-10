import { existsSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { call } from './client.mjs'
import { bindingPath, readJson } from './local.mjs'

const [directory, cwd] = process.argv.slice(2)
const lock = join(directory, 'heartbeat.lock')
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
try {
  while (!existsSync(join(directory, 'stop'))) {
    try {
      const config = readJson(join(directory, 'device.json'))
      const binding = readJson(bindingPath(cwd))
      if (config.site !== binding.site || config.projectId !== binding.projectId) break
      await call(config, 'device.heartbeat', { changeId: binding.changeId || null })
      writeFileSync(join(directory, 'heartbeat-status.json'), JSON.stringify({ online: true, at: new Date().toISOString(), pid: process.pid }), { mode: 0o600 })
    } catch (error) {
      writeFileSync(join(directory, 'heartbeat-status.json'), JSON.stringify({ online: false, at: new Date().toISOString() }), { mode: 0o600 })
      if ([401, 403].includes(error.status)) break
    }
    await new Promise(resolve => setTimeout(resolve, 15_000))
  }
} finally {
  if (existsSync(lock) && readFileSync(lock, 'utf8') === String(process.pid)) unlinkSync(lock)
}
