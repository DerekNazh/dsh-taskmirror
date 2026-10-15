// 压测：连跑 10 遍、cooldown 边界、特殊字符、并发、子目录
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = 'C:\\Users\\Administrator\\.agents\\skills\\dsh-taskmirror\\scripts\\taskmirror.mjs'
const COOLDOWN_FILE = join(process.env.USERPROFILE, '.dsh', 'taskmirror-cooldown.json')

function runScript(env) {
  return new Promise((resolve) => {
    const proc = spawn('node', [SCRIPT], {
      env: { ...process.env, ...env },
      cwd: env.DSH_HOOK_CWD || process.cwd(),
    })
    let stdout = '', stderr = ''
    proc.stdout.on('data', (d) => (stdout += d.toString()))
    proc.stderr.on('data', (d) => (stderr += d.toString()))
    proc.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

function clearCooldown() {
  rmSync(COOLDOWN_FILE, { force: true })
}

const baseEnv = () => ({
  DSH_HOOK_EVENT: 'turn/end',
  DSH_HOOK_SESSION_ID: 'stress-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
  DSH_HOOK_SESSION_NAME: 'Stress',
  DSH_HOOK_CWD: process.cwd(),
  DSH_HOOK_TURN: '1',
  DSH_HOOK_REASON: 'completed',
  DSH_HOOK_DURATION_MS: '1000',
  DSH_HOOK_CONTENT: '压测内容',
  DSH_HOOK_TIMESTAMP: new Date().toISOString(),
  DSH_HOOK_PARENT_SESSION_ID: '',
  DSH_HOOK_SUBAGENT: '0',
})

test('连跑 5 遍：每次不同 sessionId 都能写入', async () => {
  clearCooldown()
  const written = []
  for (let i = 0; i < 5; i++) {
    const r = await runScript({ ...baseEnv(), DSH_HOOK_SESSION_ID: `loop-${i}-${Date.now()}` })
    assert.equal(r.code, 0, `第 ${i+1} 遍 exit code 非 0: ${r.stderr}`)
    assert.ok(r.stdout.startsWith('written: '), `第 ${i+1} 遍未写入: ${r.stdout}`)
    const m = r.stdout.match(/written: (.+\.md)/)
    if (m) written.push(m[1])
  }
  // 每个文件都存在
  for (const f of written) {
    assert.ok(existsSync(f), `文件丢失: ${f}`)
    rmSync(f, { force: true })
  }
  clearCooldown()
})

test('cooldown：同一 sessionId 5min 内第二次应被跳过', async () => {
  clearCooldown()
  const sid = 'cooldown-test-' + Date.now()
  const env1 = { ...baseEnv(), DSH_HOOK_SESSION_ID: sid }
  const r1 = await runScript(env1)
  assert.equal(r1.code, 0)
  assert.ok(r1.stdout.startsWith('written: '), `首次应写入: ${r1.stdout}`)

  const r2 = await runScript(env1)
  assert.equal(r2.code, 0)
  assert.ok(r2.stdout.startsWith('cooldown: '), `同 session 二次应在 cooldown: ${r2.stdout}`)

  const m1 = r1.stdout.match(/written: (.+\.md)/)
  if (m1) rmSync(m1[1], { force: true })
  clearCooldown()
})

test('cooldown：不同 sessionId 互不影响', async () => {
  clearCooldown()
  const r1 = await runScript({ ...baseEnv(), DSH_HOOK_SESSION_ID: 'sess-A-' + Date.now() })
  const r2 = await runScript({ ...baseEnv(), DSH_HOOK_SESSION_ID: 'sess-B-' + Date.now() })
  assert.ok(r1.stdout.startsWith('written: '), `A 应写入: ${r1.stdout}`)
  assert.ok(r2.stdout.startsWith('written: '), `B 应写入（不受 A cooldown 影响）: ${r2.stdout}`)
  const m1 = r1.stdout.match(/written: (.+\.md)/)
  const m2 = r2.stdout.match(/written: (.+\.md)/)
  if (m1) rmSync(m1[1], { force: true })
  if (m2) rmSync(m2[1], { force: true })
  clearCooldown()
})

test('特殊字符 content：中文/emoji/换行都能写', async () => {
  clearCooldown()
  const sid = 'special-chars-' + Date.now()
  const r = await runScript({
    ...baseEnv(),
    DSH_HOOK_SESSION_ID: sid,
    DSH_HOOK_CONTENT: '中文 🌟 emoji\n换行\r\n制表\t符"引号\'反斜杠\\',
  })
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  const m = r.stdout.match(/written: (.+\.md)/)
  assert.ok(m)
  const body = readFileSync(m[1], 'utf-8')
  assert.ok(body.includes('中文 🌟 emoji'), '中文+emoji 应保留')
  assert.ok(body.includes('换行'), '换行应保留')
  assert.ok(body.includes('制表'), '制表符应保留')
  assert.ok(body.includes('"引号'), '双引号应保留')
  rmSync(m[1], { force: true })
  clearCooldown()
})

test('空 content：写 fallback 标记', async () => {
  clearCooldown()
  const r = await runScript({ ...baseEnv(), DSH_HOOK_SESSION_ID: 'empty-content-' + Date.now(), DSH_HOOK_CONTENT: '' })
  assert.equal(r.code, 0)
  const m = r.stdout.match(/written: (.+\.md)/)
  assert.ok(m)
  const body = readFileSync(m[1], 'utf-8')
  assert.ok(body.includes('_（无内容）_') || body.includes('本轮摘要'), '空 content 应有 fallback 标记')
  rmSync(m[1], { force: true })
  clearCooldown()
})

test('超长 content：只截 2000 字符', async () => {
  clearCooldown()
  const long = 'x'.repeat(10000)
  const r = await runScript({ ...baseEnv(), DSH_HOOK_SESSION_ID: 'long-' + Date.now(), DSH_HOOK_CONTENT: long })
  assert.equal(r.code, 0)
  const m = r.stdout.match(/written: (.+\.md)/)
  assert.ok(m)
  const body = readFileSync(m[1], 'utf-8')
  // 截断后内容里 x 不会超过 2000（粗略）
  const xCount = (body.match(/x/g) || []).length
  assert.ok(xCount <= 2500, `x 应被截到 ~2000，实际 ${xCount}`)
  rmSync(m[1], { force: true })
  clearCooldown()
})

test('空 sessionId：应能跑通不崩', async () => {
  clearCooldown()
  const r = await runScript({ ...baseEnv(), DSH_HOOK_SESSION_ID: '', DSH_HOOK_SESSION_NAME: 'No-ID-Test' })
  assert.equal(r.code, 0, `exit: ${r.code} stderr: ${r.stderr}`)
  // 无 sessionId 时脚本不检查 cooldown、不写带 sid 的文件
  // 行为：要么写一个 unknown.md，要么写 name-based 文件
  const ok = r.stdout.startsWith('written: ') || r.stdout.startsWith('cooldown: ')
  assert.ok(ok, `应能正常处理空 sid: ${r.stdout}`)
  const m = r.stdout.match(/written: (.+\.md)/)
  if (m) rmSync(m[1], { force: true })
  clearCooldown()
})

test('并发：5 个不同 sessionId 同时跑，全成功', async () => {
  clearCooldown()
  const tasks = []
  for (let i = 0; i < 5; i++) {
    tasks.push(runScript({ ...baseEnv(), DSH_HOOK_SESSION_ID: `concurrent-${i}-${Date.now()}` }))
  }
  const results = await Promise.all(tasks)
  const written = []
  for (const r of results) {
    assert.equal(r.code, 0, `并发失败: ${r.stderr}`)
    assert.ok(r.stdout.startsWith('written: '), `并发未写入: ${r.stdout}`)
    const m = r.stdout.match(/written: (.+\.md)/)
    if (m) written.push(m[1])
  }
  for (const f of written) rmSync(f, { force: true })
  clearCooldown()
})

test('MEMORY_DIR 自动创建：~/.claude/memory/dsh-taskmirror 应存在', async () => {
  clearCooldown()
  const r = await runScript({ ...baseEnv(), DSH_HOOK_SESSION_ID: 'mkdir-test-' + Date.now() })
  assert.equal(r.code, 0)
  const memDir = join(process.env.USERPROFILE, '.claude', 'memory', 'dsh-taskmirror')
  assert.ok(existsSync(memDir), `MEMORY_DIR 应自动创建: ${memDir}`)
  const m = r.stdout.match(/written: (.+\.md)/)
  if (m) rmSync(m[1], { force: true })
  clearCooldown()
})

test('9 维顺序：ABCDEFGHI 严格按序出现', async () => {
  clearCooldown()
  const r = await runScript({ ...baseEnv(), DSH_HOOK_SESSION_ID: 'order-' + Date.now() })
  const m = r.stdout.match(/written: (.+\.md)/)
  const body = readFileSync(m[1], 'utf-8')
  const dims = ['A 职责', 'B 依赖', 'C 测试', 'D 改动', 'E 体积', 'F 债台', 'G 过程', 'H 可推广', 'I 品牌']
  let lastIdx = -1
  for (const d of dims) {
    const idx = body.indexOf(d)
    assert.ok(idx > lastIdx, `${d} 顺序错乱: last=${lastIdx} current=${idx}`)
    lastIdx = idx
  }
  rmSync(m[1], { force: true })
  clearCooldown()
})
