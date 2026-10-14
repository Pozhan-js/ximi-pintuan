import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { privateWrite, loadConfig } from './local.mjs'
import { createBootstrap, templateHookCommands, connectionClientInfo } from './bootstrap.mjs'

export function installTemplateHook(cwd) {
  const directory = join(cwd, '.codex'), path = join(directory, 'hooks.json')
  const script = join(cwd, 'scripts/book-collaboration/template-hook.mjs')
  if ([directory, path, script].some(value => existsSync(value) && lstatSync(value).isSymbolicLink())) throw new Error('Hook 配置或脚本是符号链接，未覆盖其他位置')
  if (!existsSync(script)) throw new Error('请先将完整协作客户端更新到本仓库')
  const build = connectionClientInfo(cwd)
  if (!build.buildId) throw new Error(`请先补齐安全的协作客户端，未写入 Hook：${build.issues.join('；')}`)
  if (/["`$%!\r\n]/.test(script)) throw new Error('项目路径含 Windows Hook 无法可靠引用的字符，请使用不含特殊变量字符的路径后安装')
  let original = null, config = {}
  if (existsSync(path)) {
    original = readFileSync(path, 'utf8'); config = JSON.parse(original)
    if (!config || typeof config !== 'object' || Array.isArray(config) || (config.hooks && (typeof config.hooks !== 'object' || Array.isArray(config.hooks)))) throw new Error('已有 Hook 配置格式无法安全合并，未覆盖')
  }
  const { command, commandWindows } = templateHookCommands(cwd)
  const groups = config.hooks?.PreToolUse || []
  if (!Array.isArray(groups)) throw new Error('已有 PreToolUse 配置无法安全合并，未覆盖')
  if (groups.some(group => (!group.matcher || group.matcher === '.*') && group.hooks?.some(hook => hook.type === 'command' && hook.command === command && hook.commandWindows === commandWindows))) {
    let bootstrapRecorded = false, bootstrapError
    try { createBootstrap(cwd, loadConfig(cwd)).install(); bootstrapRecorded = true } catch (error) { bootstrapError = error.message }
    return { installed: true, unchanged: true, bootstrapRecorded, ...(bootstrapError ? { bootstrapError } : {}), path, optionalAdapter: '仅为 Codex 提供可选工具拦截；其它 Agent 的上号与升级确认不需要此 Hook。', activationRequired: '请在 Codex /hooks 核对并信任该项目 Hook，确认生效后再依赖工具拦截。' }
  }
  const hooks = { ...config.hooks, PreToolUse: [...groups, { matcher: '.*', hooks: [{ type: 'command', command, commandWindows, timeout: 5, statusMessage: '检查模板与 Skills 更新' }] }] }
  mkdirSync(directory, { recursive: true })
  if (original !== null) writeFileSync(`${path}.book-backup-${randomUUID()}`, original, { mode: 0o600, flag: 'wx' })
  privateWrite(path, { ...config, hooks })
  let bootstrapRecorded = false, bootstrapError
  try { createBootstrap(cwd, loadConfig(cwd)).install(); bootstrapRecorded = true } catch (error) { bootstrapError = error.message }
  return { installed: true, bootstrapRecorded, ...(bootstrapError ? { bootstrapError } : {}), path, optionalAdapter: '仅为 Codex 提供可选工具拦截；其它 Agent 的上号与升级确认不需要此 Hook。', activationRequired: '请在 Codex /hooks 核对并信任该项目 Hook；必要时重新打开会话，确认拦截生效。文件写入本身不代表运行中的会话已加载。' }
}
