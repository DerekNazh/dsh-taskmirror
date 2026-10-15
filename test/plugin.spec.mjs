// dsh-taskmirror 单元测试：9 维复盘脚本的核心行为。
// 用法：node --test "test/*.spec.mjs"
//
// 全部用例走隔离沙箱（见 helpers.mjs），可与 stress.spec.mjs 并行执行。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { makeSandbox, runScript, turnEndEnv, uniqueSessionId } from './helpers.mjs'

test('完整路径：9 维内容 + 沉淀文件 + cooldown 状态', async (t) => {
  const box = makeSandbox()
  t.after(() => box.cleanup())

  const sessionId = uniqueSessionId('full')
  const r = await runScript(
    turnEndEnv(box, {
      DSH_HOOK_SESSION_ID: sessionId,
      DSH_HOOK_SESSION_NAME: 'Test Session',
      DSH_HOOK_TURN: '5',
      DSH_HOOK_DURATION_MS: '12000',
      DSH_HOOK_CONTENT: '用户要求实现 9 维自检。模型在响应末尾输出了 reminder。',
    }),
  )

  assert.equal(r.code, 0, `exit code 应为 0，实际 ${r.code}；stderr: ${r.stderr}`)
  assert.ok(r.stdout.startsWith('written: '), `应输出 written: 实际: ${r.stdout}`)

  // 文件必须落在沙箱里（不会被写到用户真实 memory 目录）
  const filePath = box.retroPath(sessionId)
  assert.ok(existsSync(filePath), `复盘文件应写到这里: ${filePath}`)
  assert.ok(r.stdout.includes(filePath), `stdout 应报出沙箱路径: ${r.stdout}`)

  const body = readFileSync(filePath, 'utf-8')

  // 1. 9 个维度齐全
  for (const dim of 'ABCDEFGHI') {
    assert.ok(body.includes(`- ${dim} `), `retrospective 应包含维度 ${dim}`)
  }

  // 2. 元数据
  assert.ok(body.includes('Test Session'), '应包含 session name')
  assert.ok(body.includes('**turn**：5'), '应包含 turn 编号')
  assert.ok(body.includes('completed'), '应包含 reason')
  assert.ok(body.includes(sessionId), '应包含 sessionId')

  // 3. 本轮摘要
  assert.ok(body.includes('用户要求实现 9 维自检'), '应包含本轮摘要')

  // 4. cooldown 记在沙箱里，且记的是本次 session
  assert.ok(existsSync(box.cooldownFile), '沙箱中应生成 cooldown 文件')
  const cooldown = JSON.parse(readFileSync(box.cooldownFile, 'utf-8'))
  assert.equal(cooldown.session_id, sessionId, 'cooldown 应记录本次 session')
})

test('subagent 应被跳过', async (t) => {
  const box = makeSandbox()
  t.after(() => box.cleanup())

  const r = await runScript(turnEndEnv(box, { DSH_HOOK_SUBAGENT: '1' }))
  assert.equal(r.code, 0)
  assert.ok(r.stdout.startsWith('skipped: subagent'), `应跳过 subagent 实际: ${r.stdout}`)
  assert.ok(!existsSync(box.cooldownFile), '被跳过时不应写 cooldown')
})

test('fork 应被跳过', async (t) => {
  const box = makeSandbox()
  t.after(() => box.cleanup())

  const r = await runScript(turnEndEnv(box, { DSH_HOOK_PARENT_SESSION_ID: 'parent-1' }))
  assert.equal(r.code, 0)
  assert.ok(r.stdout.startsWith('skipped: fork'), `应跳过 fork 实际: ${r.stdout}`)
})

test('max-tokens 不跳过（半截 task 最有复盘价值）', async (t) => {
  const box = makeSandbox()
  t.after(() => box.cleanup())

  const sessionId = uniqueSessionId('maxtok')
  const r = await runScript(
    turnEndEnv(box, { DSH_HOOK_SESSION_ID: sessionId, DSH_HOOK_REASON: 'max-tokens' }),
  )
  assert.equal(r.code, 0)
  assert.ok(r.stdout.startsWith('written: '), `max-tokens 也应写复盘 实际: ${r.stdout}`)
  assert.ok(existsSync(box.retroPath(sessionId)), '应生成复盘文件')
})

test('未知 reason 应被跳过', async (t) => {
  const box = makeSandbox()
  t.after(() => box.cleanup())

  const r = await runScript(turnEndEnv(box, { DSH_HOOK_REASON: 'something-weird' }))
  assert.equal(r.code, 0)
  assert.ok(
    r.stdout.startsWith('skipped: reason=something-weird'),
    `未知 reason 应跳过 实际: ${r.stdout}`,
  )
})

test('aborted / error 也复盘（非完成同样有复盘价值）', async (t) => {
  const box = makeSandbox()
  t.after(() => box.cleanup())

  for (const reason of ['aborted', 'error']) {
    const sessionId = uniqueSessionId(reason)
    const r = await runScript(
      turnEndEnv(box, { DSH_HOOK_SESSION_ID: sessionId, DSH_HOOK_REASON: reason }),
    )
    assert.equal(r.code, 0, `${reason}: exit ${r.code} stderr ${r.stderr}`)
    assert.ok(r.stdout.startsWith('written: '), `${reason} 应写复盘 实际: ${r.stdout}`)
  }
})
