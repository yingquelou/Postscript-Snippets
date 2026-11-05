/* eslint-disable */
// gs 解释器验证：仓库内随源码分发的 .ps 文件必须能被 Ghostscript 无错执行。
// 目的：PostScript 行为以解释器为准，不以 PLRM 阅读或文档描述为准。
// 用法: node scripts/verify-ps-files.js
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const GS = ['gswin64c', 'gs'].find(g => {
  try {
    return spawnSync(g, ['--version'], { stdio: 'pipe', timeout: 20000 }).status === 0
  } catch { return false }
})

// 目录 -> 该目录下 .ps 文件必须以 exit 0 结束
const SCAN_DIRS = ['ps', 'pslib', 'docs/design/prototype']
// 已知需要特定上下文才能运行的脚本（如依赖 stdin 协议 / 外部资源）在此登记，
// 登记项只做“能被 gs 解析到错误以外”的弱校验，并打印原因。
const SKIP = new Map()

function collect(dir) {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) return []
  const out = []
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collect(rel))
    else if (entry.name.toLowerCase().endsWith('.ps')) out.push(rel)
  }
  return out
}

if (!GS) {
  console.log('SKIP  Ghostscript not found in PATH — PS verification not run')
  process.exit(0)
}

const files = SCAN_DIRS.flatMap(collect).sort()
if (files.length === 0) {
  console.log('SKIP  no .ps files found')
  process.exit(0)
}

let pass = 0, fail = 0
for (const rel of files) {
  const reason = SKIP.get(rel)
  if (reason) {
    console.log(`SKIP  ${rel}  (${reason})`)
    continue
  }
  const run = spawnSync(GS, ['-q', '-dNODISPLAY', '-dBATCH', '-dNOPAUSE', '-dNOSAFER', rel], {
    cwd: ROOT,
    input: '',
    stdio: 'pipe',
    timeout: 30000
  })
  const combined = `${run.stdout || ''}${run.stderr || ''}`.toString()
  const errorBlock = /^Error:\s/gm.test(combined)
  const ok = run.status === 0 && !errorBlock
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${rel}`)
  if (!ok) {
    const first = combined.split('\n').filter(Boolean).slice(0, 4).join(' | ')
    console.log(`      exit=${run.status}  ${first}`)
  }
}

console.log(`\n${pass} passed, ${fail} failed (gs: ${GS})`)
process.exit(fail > 0 ? 1 : 0)
