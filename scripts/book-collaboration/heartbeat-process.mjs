import { spawn } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const workerFile = fileURLToPath(new URL('./heartbeat.mjs', import.meta.url))

function lockOwner(path) {
  try { return readFileSync(path, 'utf8') } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
function isDead(owner) {
  if (!/^[1-9]\d*$/.test(owner || '') || !Number.isSafeInteger(Number(owner))) return false
  try { process.kill(Number(owner), 0); return false } catch (error) { return error.code === 'ESRCH' }
}

export function heartbeatIsRunning(directory) {
  const owner = lockOwner(join(directory, 'heartbeat.lock'))
  return /^[1-9]\d*$/.test(owner || '') && Number.isSafeInteger(Number(owner)) && !isDead(owner)
}

export function heartbeatSpawnOptions(platform = process.platform) {
  return { detached: platform !== 'win32', windowsHide: true, stdio: 'ignore' }
}

export async function stopHeartbeat(directory, { timeoutMs = 80_000 } = {}) {
  const lock = join(directory, 'heartbeat.lock')
  writeFileSync(join(directory, 'stop'), '', { mode: 0o600 })
  const deadline = Date.now() + timeoutMs
  while (true) {
    const owner = lockOwner(lock)
    if (owner === null) return { stopped: true }
    // Leave the unchanged stale lock for the worker's existing recovery algorithm.
    if (isDead(owner) && lockOwner(lock) === owner) return { stopped: true, staleLock: true }
    if (Date.now() >= deadline) throw new Error('旧心跳锁尚未退出，未启动第二个心跳；请确认原终端已经下号')
    await delay(100)
  }
}

export async function startHeartbeat(directory, cwd, { timeoutMs = 65_000, stopTimeoutMs = 80_000, spawnWorker = spawn, platform = process.platform } = {}) {
  await stopHeartbeat(directory, { timeoutMs: stopTimeoutMs })
  const stop = join(directory, 'stop')
  const status = join(directory, 'heartbeat-status.json')
  for (const path of [stop, status]) if (existsSync(path)) unlinkSync(path)
  const child = spawnWorker(process.execPath, [workerFile, directory, cwd], heartbeatSpawnOptions(platform))
  let failure
  let exited = false
  child.on('error', error => { failure = error })
  child.on('exit', () => { exited = true })
  child.unref()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (failure) throw new Error('后台心跳进程启动失败', { cause: failure })
    if (exited) throw new Error('后台心跳在确认启动前退出；请核对绑定与心跳锁')
    if (child.pid && lockOwner(join(directory, 'heartbeat.lock')) === String(child.pid)) {
      let receipt
      try { receipt = JSON.parse(readFileSync(status, 'utf8')) } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
      if (receipt?.pid === child.pid && receipt.online === true) return receipt
      if (receipt?.online === false) {
        await stopHeartbeat(directory, { timeoutMs: stopTimeoutMs })
        throw new Error('后台心跳未取得在线回执；未确认上号成功')
      }
    }
    await delay(100)
  }
  await stopHeartbeat(directory, { timeoutMs: stopTimeoutMs })
  throw new Error('后台心跳启动超时；未确认上号成功')
}
