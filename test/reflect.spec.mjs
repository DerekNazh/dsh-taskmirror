// taskmirror-reflect 的测试：验证「阻止 / 放行」两种决策与防死循环。
//
// 关键约定（从 DSH 源码验证）：
//   exit 2 + stderr  → 阻止回合结束，stderr 文本被喂回模型
//   exit 0           → 放行
//
// 全部用例走隔离沙箱，不碰用户真实台账 / history。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, '..', 'scripts', 'taskmirror-reflect.mjs')

function makeSandbox() {
  const root = mkdtempSync(join(tmpdir(), 'taskmirror-reflect-'))
  return {
    root,
    ledger: join(root, 'ledger.json'),
    history: join(root, 'history.jsonl'),
    cleanup() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}

/** 用 Buffer 直接喂 stdin（不经 shell），避免 BOM 等编码干扰。 */
function runReflect(env, payload) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [SCRIPT], { env: { ...process.env, ...env } })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => (stdout += d.toString()))
    proc.stderr.on('data', (d) => (stderr += d.toString()))
    proc.on('close', (code) => resolve({ code, stdout, stderr }))
    proc.stdin.end(Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload), 'utf-8'))
  })
}

function baseEnv(box, extra = {}) {
  return {
    TASKMIRROR_LEDGER_FILE: box.ledger,
    TASKMIRROR_HISTORY_FILE: box.history,
    TASKMIRROR_MIN_INTERVAL_MS: '0', // 默认关掉间隔兜底，单测回合计数逻辑
    ...extra,
  }
}

/** 往假 history 里追加一条 turn/end 记录。 */
function appendTurnEnd(box, sessionId) {
  const line = JSON.stringify({
    kind: 'run',
    event: 'turn/end',
    command: 'node taskmirror.mjs',
    sessionId,
    outcome: 'exit-0',
    ts: Date.now(),
  })
  writeFileSync(box.history, `${existsSync(box.history) ? readFileSync(box.history, 'utf-8') : ''}${line}\n`)
}

function stopPayload(sessionId, extra = {}) {
  return { session_id: sessionId, hook_event_name: 'Stop', stop_hook_active: false, ...extra }
}

test('首次调用：阻止回合结束（exit=2），stderr 含 9 维', async (t) => {
  const box = makeSandbox()
  t.after(() => box.cleanup())

  const r = await runReflect(baseEnv(box), stopPayload('sess-a'))

  assert.equal(r.code, 2, `应阻止（exit 2），实际 ${r.code}；stderr: ${r.stderr}`)
  for (const dim of 'ABCDEFGHI') {
    assert.ok(r.stderr.includes(`**${dim} `), `stderr 应含维度 ${dim}`)
  }
  assert.ok(r.stderr.includes('9 维自检'), 'stderr 应说明要做 9 维自检')
  assert.ok(existsSync(box.ledger), '应写入台账')
})

test('同一回合第二次：放行（exit=0），不重复阻止', async (t) => {
  const box = makeSandbox()
  t.after(() => box.cleanup())

  appendTurnEnd(box, 'sess-b')
  const first = await runReflect(baseEnv(box), stopPayload('sess-b'))
  assert.equal(first.code, 2, '首次应阻止')

  const second = await runReflect(baseEnv(box), stopPayload('sess-b'))
  assert.equal(second.code, 0, `同回合二次应放行，实际 ${second.code}`)
  assert.ok(second.stdout.includes('放行'), `应说明放行原因：${second.stdout}`)
})

test('新的 turn/end 出现后：允许再次阻止（新回合）', async (t) => {
  const box = makeSandbox()
  t.after(() => box.cleanup())

  appendTurnEnd(box, 'sess-c')
  assert.equal((await runReflect(baseEnv(box), stopPayload('sess-c'))).code, 2)

  // 新回合结束 → history 多一条
  appendTurnEnd(box, 'sess-c')
  const again = await runReflect(baseEnv(box), stopPayload('sess-c'))
  assert.equal(again.code, 2, `新回合应可再次阻止，实际 ${again.code}`)
})

test('防死循环：连打 10 次最多阻止 1 次', async (t) => {
  const box = makeSandbox()
  t.after(() => box.cleanup())

  appendTurnEnd(box, 'sess-d')
  let blocks = 0
  for (let i = 0; i < 10; i++) {
    const r = await runReflect(baseEnv(box), stopPayload('sess-d'))
    assert.ok(r.code === 0 || r.code === 2, `退出码应只有 0/2，实际 ${r.code}`)
    if (r.code === 2) blocks += 1
  }
  assert.equal(blocks, 1, `10 次调用应只阻止 1 次，实际 ${blocks}`)
})

test('间隔兜底：history 缺失时靠最小间隔防紧凑循环', async (t) => {
  const box = makeSandbox()
  t.after(() => box.cleanup())

  // history 文件不存在 → countTurnEnds 返回 null → 走间隔分支
  const env = baseEnv(box, { TASKMIRROR_MIN_INTERVAL_MS: '60000' })

  const first = await runReflect(env, stopPayload('sess-e'))
  assert.equal(first.code, 2, '首次应阻止')

  const second = await runReflect(env, stopPayload('sess-e'))
  assert.equal(second.code, 0, '间隔内应放行')
  assert.ok(second.stdout.includes('下限'), `应提到间隔下限：${second.stdout}`)
})

test('stop_hook_active=true：直接放行（尊重宿主信号）', async (t) => {
  const box = makeSandbox()
  t.after(() => box.cleanup())

  const r = await runReflect(baseEnv(box), stopPayload('sess-f', { stop_hook_active: true }))
  assert.equal(r.code, 0)
  assert.ok(r.stdout.includes('stop_hook_active'), `应说明原因：${r.stdout}`)
})

test('stdin 带 BOM：仍能解析出 session_id（鲁棒性）', async (t) => {
  const box = makeSandbox()
  t.after(() => box.cleanup())

  appendTurnEnd(box, 'sess-g')
  const r = await runReflect(baseEnv(box), `\uFEFF${JSON.stringify(stopPayload('sess-g'))}`)

  assert.equal(r.code, 2, 'BOM 不应导致决策失败')
  const ledger = JSON.parse(readFileSync(box.ledger, 'utf-8'))
  assert.ok(
    Object.keys(ledger).includes('sess-g'),
    `台账 key 应是 sessionId，实际 ${JSON.stringify(Object.keys(ledger))}`,
  )
})

test('stdin 为空/非 JSON：放行且不崩', async (t) => {
  const box = makeSandbox()
  t.after(() => box.cleanup())

  const empty = await runReflect(baseEnv(box), '')
  assert.ok(empty.code === 0 || empty.code === 2, `不应崩，实际 ${empty.code}`)

  const junk = await runReflect(baseEnv(box), 'not json at all')
  assert.equal(junk.code, 0, '无法解析时应放行，绝不该卡住回合')
})

test('不同 session 互不影响', async (t) => {
  const box = makeSandbox()
  t.after(() => box.cleanup())

  appendTurnEnd(box, 'sess-h')
  appendTurnEnd(box, 'sess-i')

  assert.equal((await runReflect(baseEnv(box), stopPayload('sess-h'))).code, 2)
  assert.equal((await runReflect(baseEnv(box), stopPayload('sess-i'))).code, 2, '另一 session 应可阻止')
  assert.equal((await runReflect(baseEnv(box), stopPayload('sess-h'))).code, 0, 'sess-h 同回合应放行')
})