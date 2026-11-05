/* eslint-disable */
// L3 + build-trace 端到端验证（真实 gs），复现 buildTrace.ts / validateWithGhostscript.ts 的确切命令构造
// 用法: node scripts/verify-l3-trace.js
const { spawnSync, execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { loadSrc } = require('./loadSrc')
// bundled from src/ — out/ holds only the esbuild bundles after `package`
const { parseGsErrorOutput, byteOffsetToCharOffset, escapePsString, parseTraceStderr } = loadSrc('src/gsParsers.ts')

const repo = path.join(__dirname, '..')
const preamble = path.join(repo, 'ps', 'build-trace-preamble.ps')
const GS = ['gswin64c', 'gs'].find(g => { try { execFileSync(g, ['--version'], { stdio: 'pipe' }); return true } catch { return false } })

function runGs(args, cwd) {
  // spawnSync (not execFileSync): execFileSync discards the child's stderr
  const r = spawnSync(GS, args, { cwd, timeout: 30000, encoding: 'utf8' })
  return { stdout: r.stdout || '', stderr: r.stderr || '', code: r.status === null ? 1 : r.status }
}

let pass = 0, fail = 0
const check = (name, cond, detail) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : '\n      ' + detail}`) }

// ── build trace e2e（含两层嵌套 run）──
// 注意：trace 记录 run 收到的原始名字（相对/绝对原样），相对名由消费方按 cwd 解析
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-trace-e2e-'))
fs.writeFileSync(path.join(dir, 'top.ps'), '(lib.ps) run\n')
fs.writeFileSync(path.join(dir, 'lib.ps'), '(nested.ps) run\n')
fs.writeFileSync(path.join(dir, 'nested.ps'), '% bottom of the chain\n')

const args = ['-q', '-dNODISPLAY', '-dBATCH', '-dNOPAUSE', '-dNOSAFER', preamble,
  '-c', `(${escapePsString(path.join(dir, 'top.ps'))}) run`, '-c', 'quit']
const traceResult = runGs(args, dir)
const ordered = parseTraceStderr(traceResult.stderr)
const expectedOrder = [path.join(dir, 'top.ps').replace(/\\/g, '/'), 'lib.ps', 'nested.ps']
check('trace e2e: nested execution order (requested names verbatim)', JSON.stringify(ordered) === JSON.stringify(expectedOrder),
  `got ${JSON.stringify(ordered)} expected ${JSON.stringify(expectedOrder)}; stderr=${traceResult.stderr.slice(0, 200)}`)

// ── L3 e2e：含多字节注释的错误文件，字节偏移 → 字符偏移换算 ──
const src = '% 中文注释：检查多字节偏移换算\nfoo pop\n'
const errFile = path.join(dir, 'gserr-e2e.ps')
fs.writeFileSync(errFile, src, 'utf8')
const l3 = runGs(['-q', '-dNODISPLAY', '-dBATCH', '-dNOPAUSE', errFile], dir)
const info = parseGsErrorOutput((l3.stdout || '') + '\n' + (l3.stderr || ''))
check('L3 e2e: error parsed (/undefined in foo)', !!info && info.errorname === 'undefined' && info.command === 'foo',
  JSON.stringify(info) + ' stderr=' + (l3.stderr || l3.stdout).slice(0, 200))
if (info && info.position !== undefined) {
  // gs pos 为 1-based，指向 token 后的终止空白：0-based 字节索引 = pos-1
  const charOffset = byteOffsetToCharOffset(src, info.position - 1)
  const token = src.slice(charOffset - 3, charOffset)
  const next = src.slice(charOffset, charOffset + 1)
  check('L3 e2e: token-end mapping lands on "foo"', token === 'foo' && /\s/.test(next),
    `charOffset=${charOffset} token=${JSON.stringify(token)} next=${JSON.stringify(next)}`)
}

// ── L3 e2e：合法文件 exit 0 ──
const okFile = path.join(dir, 'gsok-e2e.ps')
fs.writeFileSync(okFile, '1 2 add pop\n', 'utf8')
const ok = runGs(['-q', '-dNODISPLAY', '-dBATCH', '-dNOPAUSE', okFile], dir)
check('L3 e2e: valid file exits 0', ok.code === 0, `code=${ok.code} stderr=${ok.stderr.slice(0, 100)}`)

console.log(`\n${pass} passed, ${fail} failed (gs: ${GS})`)
process.exit(fail > 0 ? 1 : 0)
