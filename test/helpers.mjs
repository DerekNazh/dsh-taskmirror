// 测试共用工具：每个用例一个隔离沙箱，永不触碰用户真实状态。
//
// 为什么需要沙箱：脚本默认把 cooldown 写到 ~/.dsh/taskmirror-cooldown.json、
// 把复盘写到 ~/.claude/memory/dsh-taskmirror/。若测试直接用默认路径，两个 spec
// 文件被 node --test 并行执行时会互相覆盖 cooldown，还会删掉线上会话的真实状态。
// 因此测试一律通过 TASKMIRROR_MEMORY_DIR / TASKMIRROR_COOLDOWN_FILE 重定向。

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 被测脚本的绝对路径（相对本文件定位，不写死机器路径）。 */
export const SCRIPT = join(HERE, '..', 'scripts', 'taskmirror.mjs')

/** 建一个隔离沙箱：memory 目录 + cooldown 文件都在临时目录里。 */
export function makeSandbox() {
  const root = mkdtempSync(join(tmpdir(), 'taskmirror-test-'))
  return {
    root,
    memoryDir: join(root, 'memory'),
    cooldownFile: join(root, 'cooldown.json'),
    retroPath(sessionId) {
      return join(root, 'memory', `${sessionId}.md`)
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}

/** 跑一次脚本，返回 { code, stdout, stderr }。 */
export function runScript(env) {
  return new Promise((resolve) => {
    // 用 process.execPath 而非 'node'：不依赖 PATH，测试更稳。
    const proc = spawn(process.execPath, [SCRIPT], {
      env: { ...process.env, ...env },
      cwd: env.DSH_HOOK_CWD || process.cwd(),
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => (stdout += d.toString()))
    proc.stderr.on('data', (d) => (stderr += d.toString()))
    proc.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

let seq = 0
/** 造一个唯一的 sessionId，避免用例之间撞 cooldown。 */
export function uniqueSessionId(prefix = 'sess') {
  seq += 1
  return `${prefix}-${process.pid}-${seq}-${Math.random().toString(36).slice(2, 8)}`
}

/** 一次完整 turn/end 的默认环境变量；用 overrides 覆盖单项。 */
export function turnEndEnv(sandbox, overrides = {}) {
  return {
    TASKMIRROR_MEMORY_DIR: sandbox.memoryDir,
    TASKMIRROR_COOLDOWN_FILE: sandbox.cooldownFile,
    DSH_HOOK_EVENT: 'turn/end',
    DSH_HOOK_SESSION_ID: uniqueSessionId(),
    DSH_HOOK_SESSION_NAME: 'Test Session',
    DSH_HOOK_CWD: process.cwd(),
    DSH_HOOK_TURN: '1',
    DSH_HOOK_REASON: 'completed',
    DSH_HOOK_DURATION_MS: '1000',
    DSH_HOOK_CONTENT: '测试内容',
    DSH_HOOK_TIMESTAMP: new Date().toISOString(),
    DSH_HOOK_PARENT_SESSION_ID: '',
    DSH_HOOK_SUBAGENT: '0',
    ...overrides,
  }
}
