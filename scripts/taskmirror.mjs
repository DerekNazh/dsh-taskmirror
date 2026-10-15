#!/usr/bin/env node
/**
 * dsh-taskmirror — Post-task 9-dimension retrospective script
 *
 * 由 dsh-hooks 在 turn/end 触发。
 * 读 DSH_HOOK_* 环境变量，写 9 维自检 reminder 到 ~/.claude/memory/dsh-taskmirror/<sid>.md
 *
 * Usage (在 profile 的 cordis.patch.yml):
 *
 *   hooks:
 *     - on: 'turn/end'
 *       when: 'completed'
 *       run: 'node ~/.agents/skills/dsh-taskmirror/scripts/taskmirror.mjs'
 *       timeoutMs: 10000
 *
 * 9 维自检参照拾光客户端 architecture-review-scorecard.md
 */

import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const NINE_DIMENSION_PROMPT = `9 维自检：
- A 职责单一性
- B 依赖健康度
- C 测试完备性
- D 改动安全性
- E 体积（800行上限）
- F 债台账完整度
- G 过程规范度
- H 可推广性
- I 品牌一致性

每项 1 句话；如发现违规，把沉淀写到 ~/.claude/memory/dsh-taskmirror/<sid>.md`

const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000
const MEMORY_DIR = path.join(os.homedir(), '.claude', 'memory', 'dsh-taskmirror')
const COOLDOWN_FILE = path.join(os.homedir(), '.dsh', 'taskmirror-cooldown.json')

function readDshHookEnv() {
  return {
    event: process.env.DSH_HOOK_EVENT ?? '',
    sessionId: process.env.DSH_HOOK_SESSION_ID ?? '',
    sessionName: process.env.DSH_HOOK_SESSION_NAME ?? '',
    cwd: process.env.DSH_HOOK_CWD ?? '',
    turn: process.env.DSH_HOOK_TURN ?? '',
    reason: process.env.DSH_HOOK_REASON ?? '',
    durationMs: process.env.DSH_HOOK_DURATION_MS ?? '',
    content: process.env.DSH_HOOK_CONTENT ?? '',
    timestamp: process.env.DSH_HOOK_TIMESTAMP ?? new Date().toISOString(),
    parentSessionId: process.env.DSH_HOOK_PARENT_SESSION_ID ?? '',
    subagent: process.env.DSH_HOOK_SUBAGENT ?? '0',
  }
}

async function inCooldown(sessionId, cooldownMs) {
  if (!sessionId) return false
  try {
    const data = JSON.parse(await fs.readFile(COOLDOWN_FILE, 'utf-8'))
    if (data.session_id !== sessionId) return false
    return Date.now() - data.timestamp < cooldownMs
  } catch {
    return false
  }
}

async function setCooldown(sessionId) {
  try {
    await fs.mkdir(path.dirname(COOLDOWN_FILE), { recursive: true })
    await fs.writeFile(COOLDOWN_FILE, JSON.stringify({
      session_id: sessionId,
      timestamp: Date.now(),
    }, null, 2))
  } catch {
    // swallow — best-effort
  }
}

function isSkippable(ctx) {
  // 跳过 subagent 和 fork（与 dsh-taskmirror policy 一致）
  if (ctx.subagent === '1') return true
  if (ctx.parentSessionId) return true
  // 跳过非 completed（除非显式 want error/aborted reflection）
  const allowed = new Set(['completed', 'error', 'aborted', 'max-tokens'])
  return ctx.reason && !allowed.has(ctx.reason)
}

function buildRetrospective(ctx) {
  const lines = [
    `# TaskMirror 复盘`,
    ``,
    `**生成时间**：${ctx.timestamp}`,
    `**session**：${ctx.sessionName || ctx.sessionId || 'unknown'}`,
    `**turn**：${ctx.turn || '?'}`,
    `**reason**：${ctx.reason || 'unknown'}`,
    `**cwd**：${ctx.cwd || 'unknown'}`,
    `**duration**：${ctx.durationMs || '?'}ms`,
    ``,
    `## 9 维自检`,
    ``,
    NINE_DIMENSION_PROMPT,
    ``,
    `## 本轮摘要`,
    ``,
    ctx.content
      ? ctx.content.substring(0, 2000)
      : '_（无内容）_',
    ``,
  ]
  return lines.join('\n')
}

async function main() {
  const ctx = readDshHookEnv()

  // 1. 跳过 subagent / fork / 非 completed
  if (isSkippable(ctx)) {
    process.stdout.write(`skipped: ${ctx.subagent === '1' ? 'subagent' : ctx.parentSessionId ? 'fork' : `reason=${ctx.reason}`}\n`)
    return
  }

  // 2. 5min cooldown（同 session 不重复触发）
  if (await inCooldown(ctx.sessionId, DEFAULT_COOLDOWN_MS)) {
    process.stdout.write(`cooldown: skip within 5min for ${ctx.sessionId}\n`)
    return
  }
  await setCooldown(ctx.sessionId)

  // 3. 写 retrospective
  try {
    await fs.mkdir(MEMORY_DIR, { recursive: true })
    const file = path.join(MEMORY_DIR, `${ctx.sessionId}.md`)
    const content = buildRetrospective(ctx)
    await fs.writeFile(file, content, 'utf-8')
    process.stdout.write(`written: ${file}\n`)
  } catch (e) {
    process.stderr.write(`write failed: ${e.message}\n`)
    process.exit(1)
  }
}

main().catch((e) => {
  process.stderr.write(`error: ${e.message}\n`)
  process.exit(1)
})
