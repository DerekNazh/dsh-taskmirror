// 压测：连跑、cooldown 边界、特殊字符、并发、目录创建、维度顺序。
// 用法：node --test "test/*.spec.mjs"
//
// 全部用例走隔离沙箱（见 helpers.mjs），可与 plugin.spec.mjs 并行执行。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { makeSandbox, runScript, turnEndEnv, uniqueSessionId } from './helpers.mjs'

test('连跑 5 遍：每次不同 sessionId 都能写入', async (t) => {
  const box = makeSandbox()
  t.after(() => box.cleanup())

  for (let i = 0; i < 5; i++) {
    const sessionId = uniqueSessionId(`loop${i}`)
    const r = await runScript(turnEndEnv(box, { DSH_HOOK_SESSION_ID: sessionId }))
    assert.equal(r.code, 0, `第 ${i + 1} 遍 exit code 非 0: ${r.stderr}`)
    assert.ok(r.stdout.startsWith('written: '), `第 ${i + 1} 遍未写入: ${r.stdout}`)
    assert.ok(existsSync(box.retroPath(sessionId)), `第 ${i + 1} 遍文件丢失`)
  }
})

test('cooldown：同一 sessionId 5min 内第二次应被跳过', async (t) => {
  const box = makeSandbox()
  t.after(() => box.cleanup())

  const env = turnEndEnv(box, { DSH_HOOK_SESSION_ID: uniqueSessionId('cd') })

  const r1 = await runScript(env)
  assert.equal(r1.code, 0)
  assert.ok(r1.stdout.startsWith('written: '), `首次应写入: ${r1.stdout}`)

  const r2 = await runScript(env)
  assert.equal(r2.code, 0)
  assert.ok(r2.stdout.startsWith('cooldown: '), `同 session 二次应命中 cooldown: ${r2.stdout}`)
})

test('cooldown：不同 sessionId 互不影响', async (t) => {
  const box = makeSandbox()
  t.after(() => box.cleanup())

  const r1 = await runScript(turnEndEnv(box, { DSH_HOOK_SESSION_ID: uniqueSessionId('A') }))
  const r2 = await runScript(turnEndEnv(box, { DSH_HOOK_SESSION_ID: uniqueSessionId('B') }))
  assert.ok(r1.stdout.startsWith('written: '), `A 应写入: ${r1.stdout}`)
  assert.ok(r2.stdout.startsWith('written: '), `B 不应受 A 的 cooldown 影响: ${r2.stdout}`)
})

test('特殊字符 content：中文/emoji/换行都能写', async (t) => {
  const box = makeSandbox()
  t.after(() => box.cleanup())

  const sessionId = uniqueSessionId('chars')
  const r = await runScript(
    turnEndEnv(box, {
      DSH_HOOK_SESSION_ID: sessionId,
      DSH_HOOK_CONTENT: '中文 🌟 emoji\n换行\r\n制表\t符"引号\'反斜杠\\',
    }),
  )
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  const body = readFileSync(box.retroPath(sessionId), 'utf-8')
  assert.ok(body.includes('中文 🌟 emoji'), '中文+emoji 应保留')
  assert.ok(body.includes('换行'), '换行应保留')
  assert.ok(body.includes('制表'), '制表符应保留')
  assert.ok(body.includes('"引号'), '双引号应保留')
})

test('空 content：写 fallback 标记', async (t) => {
  const box = makeSandbox()
  t.after(() => box.cleanup())

  const sessionId = uniqueSessionId('empty')
  const r = await runScript(turnEndEnv(box, { DSH_HOOK_SESSION_ID: sessionId, DSH_HOOK_CONTENT: '' }))
  assert.equal(r.code, 0)
  const body = readFileSync(box.retroPath(sessionId), 'utf-8')
  assert.ok(body.includes('_（无内容）_'), '空 content 应有 fallback 标记')
})

test('超长 content：只截 2000 字符', async (t) => {
  const box = makeSandbox()
  t.after(() => box.cleanup())

  const sessionId = uniqueSessionId('long')
  // 用大写 X 作标记：sessionId/name 全是小写 base36 或中文，不会撞上
  const r = await runScript(
    turnEndEnv(box, { DSH_HOOK_SESSION_ID: sessionId, DSH_HOOK_CONTENT: 'X'.repeat(10000) }),
  )
  assert.equal(r.code, 0)
  const body = readFileSync(box.retroPath(sessionId), 'utf-8')
  const markCount = (body.match(/X/g) || []).length
  assert.equal(markCount, 2000, `content 应被精确截到 2000 字符，实际 ${markCount}`)
})

test('空 sessionId：应能跑通不崩', async (t) => {
  const box = makeSandbox()
  t.after(() => box.cleanup())

  const r = await runScript(
    turnEndEnv(box, { DSH_HOOK_SESSION_ID: '', DSH_HOOK_SESSION_NAME: 'No-ID-Test' }),
  )
  assert.equal(r.code, 0, `exit: ${r.code} stderr: ${r.stderr}`)
  assert.ok(
    r.stdout.startsWith('written: ') || r.stdout.startsWith('cooldown: '),
    `应能正常处理空 sid: ${r.stdout}`,
  )
})

test('并发：5 个不同 sessionId 同时跑，全成功', async (t) => {
  const box = makeSandbox()
  t.after(() => box.cleanup())

  const ids = Array.from({ length: 5 }, (_, i) => uniqueSessionId(`conc${i}`))
  const results = await Promise.all(
    ids.map((sessionId) => runScript(turnEndEnv(box, { DSH_HOOK_SESSION_ID: sessionId }))),
  )

  for (const [i, r] of results.entries()) {
    assert.equal(r.code, 0, `并发第 ${i + 1} 个失败: ${r.stderr}`)
    assert.ok(r.stdout.startsWith('written: '), `并发第 ${i + 1} 个未写入: ${r.stdout}`)
    assert.ok(existsSync(box.retroPath(ids[i])), `并发第 ${i + 1} 个文件丢失`)
  }
})

test('TASKMIRROR_MEMORY_DIR 多级目录自动创建', async (t) => {
  const box = makeSandbox()
  t.after(() => box.cleanup())

  const nested = `${box.root}/a/b/c/memory`
  const sessionId = uniqueSessionId('nested')
  const r = await runScript(
    turnEndEnv(box, { DSH_HOOK_SESSION_ID: sessionId, TASKMIRROR_MEMORY_DIR: nested }),
  )
  assert.equal(r.code, 0)
  assert.ok(existsSync(`${nested}/${sessionId}.md`), '多级目录应被递归创建')
})

test('9 维顺序：ABCDEFGHI 严格按序出现', async (t) => {
  const box = makeSandbox()
  t.after(() => box.cleanup())

  const sessionId = uniqueSessionId('order')
  const r = await runScript(turnEndEnv(box, { DSH_HOOK_SESSION_ID: sessionId }))
  assert.ok(r.stdout.startsWith('written: '), `应写入: ${r.stdout}`)

  const body = readFileSync(box.retroPath(sessionId), 'utf-8')
  const dims = ['A 职责', 'B 依赖', 'C 测试', 'D 改动', 'E 体积', 'F 债台', 'G 过程', 'H 可推广', 'I 品牌']
  let lastIdx = -1
  for (const dim of dims) {
    const idx = body.indexOf(dim)
    assert.ok(idx > lastIdx, `${dim} 顺序错乱: last=${lastIdx} current=${idx}`)
    lastIdx = idx
  }
})

test('沙箱隔离：用例全程不写用户真实状态目录', async (t) => {
  const box = makeSandbox()
  t.after(() => box.cleanup())

  const before = readUserStateSnapshot()
  const r = await runScript(turnEndEnv(box, { DSH_HOOK_SESSION_ID: uniqueSessionId('iso') }))
  assert.equal(r.code, 0)
  assert.ok(r.stdout.includes(box.root), '输出路径应位于沙箱内')
  assert.deepEqual(readUserStateSnapshot(), before, '用户真实状态目录不应被本次用例改动')
})

/** 记录用户真实状态目录的当前形态（只读快照，用于隔离性断言）。 */
function readUserStateSnapshot() {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
  const memoryDir = `${home}\\.claude\\memory\\dsh-taskmirror`
  const cooldown = `${home}\\.dsh\\taskmirror-cooldown.json`
  return {
    memoryDirExists: existsSync(memoryDir),
    cooldownExists: existsSync(cooldown),
    cooldownMtime: existsSync(cooldown) ? readFileSync(cooldown, 'utf-8') : null,
  }
}
