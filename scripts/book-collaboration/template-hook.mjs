#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bindingPath, readJson, workspace, loadConfig } from './local.mjs'
import { createTemplateUpdater } from './updates.mjs'
import { createBootstrap } from './bootstrap.mjs'

const recoveryCommands = new Set(['up', 'down', 'help', 'status', 'show', 'upgrade-status', 'read-upgrade-rules', 'complete-upgrade', 'check-updates', 'configure-updates', 'sync-updates', 'recover-updates', 'read-updates', 'ack-updates', 'install-update-hook'])
const readTools = /^(Read|Glob|Grep|read_file|view_image|request_user_input|request_user_input_async)$/
function tokens(command) {
  // Recovery is one explicit command, never a compound shell script.
  if (typeof command !== 'string' || /[\r\n;&|`$<>]/.test(command)) return null
  const result = command.match(/"[^"]*"|'[^']*'|[^\s"']+/g)
  if (!result || result.join(' ').replace(/\s+/g, ' ') !== command.trim().replace(/\s+/g, ' ')) return null
  return result.map(value => /^['"]/.test(value) ? value.slice(1, -1) : value)
}
function isRecovery(input, root) {
  const command = input.tool_input?.command ?? input.tool_input?.cmd
  const args = tokens(command)
  if (!args || args.length < 3 || !/(?:^|[\\/])node(?:\.exe)?$/i.test(args[0])) return false
  const script = resolve(realpathSync(input.cwd || root), args[1])
  const expected = resolve(root, 'scripts/book-collaboration/cli.mjs')
  if (process.platform === 'win32' ? script.toLowerCase() !== expected.toLowerCase() : script !== expected) return false
  return recoveryCommands.has(args[2]) && args.slice(3).every(value => !/[\r\n;&|`$<>]/.test(value))
}
function isRecoveryInput(input, root) {
  if (input.tool_name !== 'apply_patch' || typeof input.tool_input?.command !== 'string') return false
  const patch = input.tool_input.command
  if ([join(root, '.tmp'), join(root, '.tmp/book-template-update-input.json')].some(path => existsSync(path) && lstatSync(path).isSymbolicLink())) return false
  if (/^\*\*\* (Move to|Delete File):/m.test(patch)) return false
  const headers = [...patch.matchAll(/^\*\*\* (?:Add|Update) File: (.+)$/gm)]
  return headers.length > 0 && headers.every(([, path]) => resolve(realpathSync(input.cwd), path) === resolve(root, '.tmp/book-template-update-input.json'))
}
function output(context, deny = false) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', ...(deny ? { permissionDecision: 'deny', permissionDecisionReason: context } : {}), additionalContext: context } }
}

export function evaluateTemplateHook(input) {
  if (!input || input.hook_event_name !== 'PreToolUse' || typeof input.cwd !== 'string') return output('模板检查输入无效，先核对项目与 Hook 配置。', true)
  let root
  try { root = workspace(input.cwd) } catch { return {} }
  const binding = bindingPath(root)
  if (!existsSync(binding)) return {}
  let bootstrap
  try { bootstrap = createBootstrap(root, loadConfig(root)); bootstrap.observe(input) } catch {}
  if (readTools.test(input.tool_name || '') || isRecovery(input, root) || isRecoveryInput(input, root)) return {}
  try {
    if (!bootstrap) throw new Error('请先上号并完成升级连接工具前置任务')
    bootstrap.assertReady()
    const client = createTemplateUpdater(root, readJson(binding))
    client.assertReady()
    return {}
  } catch (error) {
    return output(`${error.message}\n先保留当前任务修改。使用本仓库 CLI 的 check-updates / configure-updates / sync-updates / recover-updates / read-updates 处理更新；接入或恢复输入 JSON 可用 apply_patch 写入 .tmp/book-template-update-input.json，再由单条 CLI --file 读取。重读规则并确认运行版本生效后再运行 ack-updates。不要 reset、自动 stash 或覆盖学员修改。同步与只读恢复命令仍可执行。`, true)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(evaluateTemplateHook(JSON.parse(readFileSync(0, 'utf8'))))}\n`) }
  catch { process.stdout.write(`${JSON.stringify(output('无法检查模板版本，先核对本机更新状态和 Hook 配置。', true))}\n`) }
}
