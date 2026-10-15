// dsh-taskmirror 单元测试：验证 9 维复盘脚本的 4 项核心行为
// 用法：node --test test/plugin.spec.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = 'C:\\Users\\Administrator\\.agents\\skills\\dsh-taskmirror\\scripts\\taskmirror.mjs'

function runScript(env) {
  return new Promise((resolve) => {
    const proc = spawn('node', [SCRIPT], {
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

test('完整路径：9 维内容 + 沉淀文件 + cooldown 状态', async () => {
  const sessionId = 'test-sess-' + Date.now()
  const memDir = mkdtempSync(join(tmpdir(), 'tm-mem-'))
  const result = await runScript({
    DSH_HOOK_EVENT: 'turn/end',
    DSH_HOOK_SESSION_ID: sessionId,
    DSH_HOOK_SESSION_NAME: 'Test Session',
    DSH_HOOK_CWD: process.cwd(),
    DSH_HOOK_TURN: '5',
    DSH_HOOK_REASON: 'completed',
    DSH_HOOK_DURATION_MS: '12000',
    DSH_HOOK_CONTENT: '用户要求实现 9 维自检。模型在响应末尾输出了 reminder。',
    DSH_HOOK_TIMESTAMP: new Date().toISOString(),
    DSH_HOOK_PARENT_SESSION_ID: '',
    DSH_HOOK_SUBAGENT: '0',
  })

  assert.equal(result.code, 0, `exit code 应该为 0，实际 ${result.code}；stderr: ${result.stderr}`)
  assert.ok(result.stdout.startsWith('written: '), `应输出 written: 实际: ${result.stdout}`)

  // 找写入的文件
  const m = result.stdout.match(/written: (.+\.md)/)
  assert.ok(m, 'stdout 应含 written: 路径')
  const filePath = m[1]
  const body = readFileSync(filePath, 'utf-8')

  // 1. 包含 9 维
  for (const l of 'ABCDEFGHI') {
    assert.ok(body.includes(`- ${l} `), `retrospective 应包含维度 ${l}`)
  }

  // 2. 包含 session / turn 元数据
  assert.ok(body.includes('Test Session'), '应包含 session name')
  assert.ok(body.includes('**turn**：5'), '应包含 turn 编号')
  assert.ok(body.includes('completed'), '应包含 reason')

  // 3. 包含 content 摘要
  assert.ok(body.includes('用户要求实现 9 维自检'), '应包含本轮摘要')

  // 4. cooldown 文件已写
  const cooldownFile = join(process.env.USERPROFILE, '.dsh', 'taskmirror-cooldown.json')
  const cooldownData = JSON.parse(readFileSync(cooldownFile, 'utf-8'))
  assert.equal(cooldownData.session_id, sessionId, 'cooldown 应记录本次 session')

  // 清理
  rmSync(filePath, { force: true })
  rmSync(memDir, { recursive: true, force: true })
  rmSync(cooldownFile, { force: true })
})

test('subagent 应被跳过', async () => {
  const result = await runScript({
    DSH_HOOK_EVENT: 'turn/end',
    DSH_HOOK_SESSION_ID: 'subagent-test',
    DSH_HOOK_REASON: 'completed',
    DSH_HOOK_SUBAGENT: '1',
    DSH_HOOK_CWD: process.cwd(),
    DSH_HOOK_TURN: '1',
  })
  assert.equal(result.code, 0)
  assert.ok(result.stdout.startsWith('skipped: subagent'), `应跳过 subagent 实际: ${result.stdout}`)
})

test('fork 应被跳过', async () => {
  const result = await runScript({
    DSH_HOOK_EVENT: 'turn/end',
    DSH_HOOK_SESSION_ID: 'fork-test',
    DSH_HOOK_REASON: 'completed',
    DSH_HOOK_PARENT_SESSION_ID: 'parent-1',
    DSH_HOOK_CWD: process.cwd(),
    DSH_HOOK_TURN: '1',
  })
  assert.equal(result.code, 0)
  assert.ok(result.stdout.startsWith('skipped: fork'), `应跳过 fork 实际: ${result.stdout}`)
})

test('max-tokens 不跳过（半截 task 最有复盘价值）', async () => {
  const sessionId = 'max-tokens-test-' + Date.now()
  const result = await runScript({
    DSH_HOOK_EVENT: 'turn/end',
    DSH_HOOK_SESSION_ID: sessionId,
    DSH_HOOK_REASON: 'max-tokens',
    DSH_HOOK_CWD: process.cwd(),
    DSH_HOOK_TURN: '1',
  })
  assert.equal(result.code, 0)
  assert.ok(result.stdout.startsWith('written: '), `max-tokens 也应写复盘 实际: ${result.stdout}`)
  // 清理
  const m = result.stdout.match(/written: (.+\.md)/)
  if (m) rmSync(m[1], { force: true })
  rmSync(join(process.env.USERPROFILE, '.dsh', 'taskmirror-cooldown.json'), { force: true })
})

test('未知 reason 应被跳过', async () => {
  const result = await runScript({
    DSH_HOOK_EVENT: 'turn/end',
    DSH_HOOK_SESSION_ID: 'unknown-reason-test',
    DSH_HOOK_REASON: 'something-weird',
    DSH_HOOK_CWD: process.cwd(),
    DSH_HOOK_TURN: '1',
  })
  assert.equal(result.code, 0)
  assert.ok(result.stdout.startsWith('skipped: reason=something-weird'), `未知 reason 应跳过 实际: ${result.stdout}`)
})
