#!/usr/bin/env node
/**
 * taskmirror-reflect — Stop 钩子：回合结束前强制 9 维自检（原型）
 *
 * 机制（已从 DSH 源码逐环验证）：
 *   1. agent-loop 在回合即将结束时 `await dispatch.serial('agent/turn-stopping', …)`
 *      —— 串行等待，循环必须等钩子返回（dsh-agent-loop/lib/index.js:999）
 *   2. 返回后**重新检查** inbox：钩子若往 inbox 塞了消息，循环就不 break，
 *      而是继续跑下一个 step（同文件 :1005）
 *   3. 桥接层 @deepseek-ai/dsh-hooks-claude-code 把本脚本的退出码翻译成决策：
 *        退出 0 → 放行
 *        退出 2 → decision=block → rank 3 → 归一为 "deny"
 *                 → agent.steer(<stderr 文本>)，模型被打断并把这段文本当指令
 *      （dsh-hook-protocol: BLOCKING_EXIT_CODE=2；merge.js rank("block")=3
 *        → decisionForRank(3)="deny"；hooks-claude-code:298 `=== "deny"` 命中）
 *
 * 死循环防护（必须自己做，桥接层没有）：
 *   桥接层把 stop_hook_active 硬编码为 false（hooks-claude-code:387），
 *   没有内建去重。本脚本用两条独立保险：
 *     A. 回合计数：数 dsh-hooks 的 history.jsonl 里本 session 已有多少条 turn/end。
 *        自上次阻止以来若新增了 turn/end，说明已进入新回合 → 可以再阻止；
 *        没新增 → 同一回合内 → 放行。这一条天然保证「一个回合最多阻止一次」。
 *     B. 最小间隔：兜底，防止 A 依赖的文件缺失/未更新时出现紧凑循环。
 *
 * stdin 收到 Claude Code 格式的 Stop payload（JSON）。
 * 退出码：0 = 放行；2 = 阻止并把 stderr 喂回模型。
 */

import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/** 兜底最小间隔：两次阻止之间至少间隔这么久（毫秒）。 */
const MIN_INTERVAL_MS = Number(process.env.TASKMIRROR_MIN_INTERVAL_MS ?? 60_000)

/** dsh-hooks 的执行历史（用来数本 session 的 turn/end 条数）。 */
const HISTORY_FILE =
  process.env.TASKMIRROR_HISTORY_FILE ??
  path.join(os.homedir(), '.dsh', 'dsh-hooks', 'history.jsonl')

/** 记账文件：记录每个 session 上次阻止时的 turn/end 计数与时间。 */
const LEDGER_FILE =
  process.env.TASKMIRROR_LEDGER_FILE ??
  path.join(os.homedir(), '.dsh', 'taskmirror-reflect-ledger.json')

const NINE_DIMENSIONS = `逐条给出结论（不要只复述维度名）。没问题的写「无问题」，有问题的必须给出具体文件名、行号或行为：

**A 职责单一性** — 本轮改动的文件里，有没有一个文件/函数承担了两种以上职责？
**B 依赖健康度** — 新增的依赖是否必要？有没有引入循环依赖或重量级包？
**C 测试完备性** — 本轮改动有对应测试吗？断言的是行为还是实现细节？
**D 改动安全性** — 有没有改公共 API / 数据格式 / 配置格式？有无兼容处理？
**E 体积** — 涉及的文件有没有超过 800 行？超了有没有拆？
**F 债台账完整度** — 本轮留下的临时方案、TODO、已知缺陷记进台账了吗？
**G 过程规范度** — 有没有跳过该走的流程（先读再改、改完验证）？
**H 可推广性** — 换个项目这个做法还成立吗？有没有把项目特有约定写进通用层？
**I 品牌一致性** — 命名、文案、错误信息跟项目既有风格一致吗？`

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  // 去掉 BOM 与首尾空白：某些宿主/shell 会在 JSON 前加 U+FEFF，
  // 直接 JSON.parse 会失败 → session_id 落空 → 去重静默失效。
  return Buffer.concat(chunks)
    .toString('utf-8')
    .replace(/^\uFEFF/, '')
    .trim()
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8'))
  } catch {
    return fallback
  }
}

async function writeJson(file, data) {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify(data, null, 2))
    return true
  } catch {
    return false
  }
}

/**
 * 数 history.jsonl 里本 session 的 turn/end 条数。
 * 只读文件尾部一段（够用且不受大文件影响）。
 */
async function countTurnEnds(sessionId) {
  if (!sessionId) return null
  let text
  try {
    const stat = await fs.stat(HISTORY_FILE)
    const tailBytes = Math.min(stat.size, 256 * 1024)
    const handle = await fs.open(HISTORY_FILE, 'r')
    try {
      const buf = Buffer.alloc(tailBytes)
      await handle.read(buf, 0, tailBytes, stat.size - tailBytes)
      text = buf.toString('utf-8')
    } finally {
      await handle.close()
    }
  } catch {
    return null // 文件不存在或读不了 → 交给兜底逻辑
  }

  let count = 0
  for (const line of text.split('\n')) {
    if (!line.includes('"turn/end"')) continue
    try {
      const rec = JSON.parse(line)
      if (rec.event === 'turn/end' && rec.sessionId === sessionId) count += 1
    } catch {
      // 半行（尾部截断）忽略
    }
  }
  return count
}

async function readSummary(sessionId) {
  const dir =
    process.env.TASKMIRROR_MEMORY_DIR ??
    path.join(os.homedir(), '.claude', 'memory', 'dsh-taskmirror')
  try {
    const body = await fs.readFile(path.join(dir, `${sessionId}.md`), 'utf-8')
    const part = body.split('## 本轮摘要')[1]
    return part ? part.trim().slice(0, 500) : ''
  } catch {
    return ''
  }
}

async function main() {
  let payload = {}
  try {
    payload = JSON.parse(await readStdin())
  } catch {
    // 无上下文也继续，下面按「信息不足则放行」处理
  }

  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : ''

  // 宿主若自己实现了去重信号，尊重它
  if (payload.stop_hook_active === true) {
    process.stdout.write('放行：stop_hook_active=true\n')
    return 0
  }

  // 认不出会话就无法去重 → 必须放行。
  // 否则一旦 payload 畸形，就会每个回合都阻止且无法收敛（无界循环）。
  // 安全方向是「宁可漏提醒一次，也不能卡住用户的回合」。
  if (sessionId === '') {
    process.stdout.write('放行：payload 里没有 session_id，无法去重\n')
    return 0
  }

  const ledger = await readJson(LEDGER_FILE, {})
  const entry = ledger[sessionId] ?? { turnEnds: null, at: 0 }

  const now = Date.now()
  const turnEnds = await countTurnEnds(sessionId)

  // 保险 A：同一回合内不重复阻止
  if (turnEnds !== null && entry.turnEnds !== null && turnEnds <= entry.turnEnds) {
    process.stdout.write(
      `放行：本回合已自检过（turn/end 计数 ${turnEnds}，未增长）\n`,
    )
    return 0
  }

  // 保险 B：最小间隔兜底（A 不可用或计数未更新时）
  if (now - entry.at < MIN_INTERVAL_MS) {
    process.stdout.write(
      `放行：距上次阻止仅 ${now - entry.at}ms（下限 ${MIN_INTERVAL_MS}ms）\n`,
    )
    return 0
  }

  await writeJson(LEDGER_FILE, {
    ...ledger,
    [sessionId]: { turnEnds, at: now },
  })

  const summary = await readSummary(sessionId)
  const parts = [
    '在结束这个回合之前，先做一次 9 维自检。',
    '',
    NINE_DIMENSIONS,
  ]
  if (summary) parts.push('', `（上一回合摘要，供参考）`, summary)
  parts.push('', '做完自检即可结束回合；这只会提醒一次，不会反复打断。')

  // stderr + 退出码 2 → 阻止回合结束，并把这段文本作为指令喂回模型
  process.stderr.write(parts.join('\n'))
  return 2
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    // 任何内部错误都放行：绝不因为自检钩子卡死用户的回合
    process.stderr.write(`taskmirror-reflect 内部错误，已放行：${error.message}\n`)
    process.exit(0)
  })