#!/usr/bin/env node
// 简化版 verify：只检查没有 link:/file: 依赖（其他规则已无意义）
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const failures = []
const skips = ['node_modules', '.git']

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (skips.includes(entry)) continue
    const p = join(dir, entry)
    const s = statSync(p)
    if (s.isDirectory()) {
      walk(p)
    } else if (s.isFile() && (entry.endsWith('.mjs') || entry.endsWith('.js') || entry.endsWith('.json') || entry.endsWith('.yml'))) {
      try {
        const content = readFileSync(p, 'utf8')
        const matches = content.matchAll(/(["'])(file|link|portal|workspace|git\+):[^"']+\1/g)
        for (const m of matches) {
          failures.push(`${p}: forbidden spec '${m[0]}'`)
        }
      } catch {}
    }
  }
}

walk(ROOT)
if (failures.length > 0) {
  console.error('FAIL:')
  for (const f of failures) console.error('  ' + f)
  process.exit(1)
} else {
  console.log('PASS: self-contained')
}
