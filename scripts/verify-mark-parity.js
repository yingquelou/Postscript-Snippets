/* eslint-disable */
// issue #2 语义一致性验证：LS 诊断 vs gs 10.08 实际行为
// 用法: node scripts/verify-mark-parity.js
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { loadSrc } = require('./loadSrc')
// bundled from src/ — out/ holds only the esbuild bundles after `package`
const { parsePostScript, DEFAULT_MARK_OPERATORS } = loadSrc('src/language-server/symbolBuilder.ts')

const GS = ['gswin64c', 'gs'].find(g => { try { execFileSync(g, ['--version'], { stdio: 'pipe' }); return true } catch { return false } })

function gsRun(snippet) {
  const f = path.join(os.tmpdir(), 'ps-parity.ps')
  fs.writeFileSync(f, snippet + '\nquit\n')
  try {
    execFileSync(GS, ['-q', '-dNODISPLAY', '-dBATCH', '-dNOPAUSE', f], { stdio: 'pipe', timeout: 15000 })
    return { ok: true, out: '' }
  } catch (e) {
    return { ok: false, out: String(e.stderr || e.message) }
  }
}

function lsFlagged(snippet) {
  return parsePostScript(snippet).errors.length > 0
}

// expectation: gsOk = gs 是否无错；lsShouldFlag = LS 是否应当出告警（结构性问题）
const cases = [
  { name: 'issue#1: [ /Title (x) /DOCINFO pdfmark', snippet: '[ /Title (x) /DOCINFO pdfmark', gsOk: true, lsShouldFlag: false },
  { name: '[ 1 2 3 cleartomark', snippet: '[ 1 2 3 cleartomark', gsOk: true, lsShouldFlag: false },
  { name: 'mark 1 2 3 cleartomark', snippet: 'mark 1 2 3 cleartomark', gsOk: true, lsShouldFlag: false },
  { name: 'nested: [ [ 1 2 ] cleartomark', snippet: '[ [ 1 2 ] cleartomark', gsOk: true, lsShouldFlag: false },
  { name: 'suspend: [ 1 2 3 clear', snippet: '[ 1 2 3 clear', gsOk: true, lsShouldFlag: false },
  { name: 'procedure guard: [ 1 { 2 cleartomark } ]', snippet: '[ 1 { 2 cleartomark } ]', gsOk: true, lsShouldFlag: false },
  { name: 'leftover open [ (gs silent on leftover stack)', snippet: '[ 1 2 3', gsOk: true, lsShouldFlag: true, stylistic: true },
  { name: 'hard error: unmatched ] (gs unmatchedmark)', snippet: '1 2 3 ]', gsOk: false, lsShouldFlag: true },
  // `/]` is NOT a name token — it scans as an empty literal name plus `]`.
  // Referencing the `]` operator requires construction: (]) load / (]) cvn cvx.
  { name: 'invalid: /pdfmark /] load def (gs: unmatchedmark)', snippet: '/pdfmark /] load def', gsOk: false, lsShouldFlag: true },
  { name: 'idiom: /pdfmark (]) load def', snippet: '/pdfmark (]) load def', gsOk: true, lsShouldFlag: false },
  { name: 'idiom: /pdfmark (]) cvn cvx def', snippet: '/pdfmark (]) cvn cvx def', gsOk: true, lsShouldFlag: false },
  { name: 'packedarray consumes the mark (gs-verified)', snippet: 'mark 1 2 3 packedarray', gsOk: true, lsShouldFlag: false },
  { name: 'array takes an int size, does not consume the mark', snippet: 'mark 1 2 3 array', gsOk: true, lsShouldFlag: true, stylistic: true },
  { name: 'bind idiom: /pdfmark {cleartomark} bind def (no mark)', snippet: '/pdfmark {cleartomark} bind def', gsOk: true, lsShouldFlag: false },
  { name: 'stylistic only: mark 1 2 3 (leftover, gs silent)', snippet: 'mark 1 2 3', gsOk: true, lsShouldFlag: true, stylistic: true },
  { name: 'stylistic only: [ 1 2 counttomark (read-only)', snippet: '[ 1 2 counttomark', gsOk: true, lsShouldFlag: true, stylistic: true },
  // `//name` is an immediate name — the same operator as the bare name.
  { name: 'immediate name: mark 1 2 //cleartomark', snippet: 'mark 1 2 //cleartomark', gsOk: true, lsShouldFlag: false },
  { name: 'immediate name: [ /Title (x) /DOCINFO //pdfmark', snippet: '[ /Title (x) /DOCINFO //pdfmark', gsOk: true, lsShouldFlag: false },
  { name: 'immediate name of a non-consuming proc', snippet: '/noop {} def mark 1 2 //noop', gsOk: true, lsShouldFlag: true, stylistic: true },
]

let pass = 0, fail = 0
for (const c of cases) {
  const gs = gsRun(c.snippet)
  const ls = lsFlagged(c.snippet)
  const gsMatch = gs.ok === c.gsOk
  const lsMatch = ls === c.lsShouldFlag
  const ok = gsMatch && lsMatch
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`)
  if (!ok) {
    console.log(`      gs: ok=${gs.ok} (expected ${c.gsOk})  ${gs.out.split('\n').filter(Boolean).slice(0,3).join(' | ')}`)
    console.log(`      LS flagged=${ls} (expected ${c.lsShouldFlag})`)
  }
}

// outline preservation check
const r = parsePostScript('[ /Title (x) /DOCINFO pdfmark')
const consumer = r.symbols[0]
const outlineOk = r.symbols.length === 1 && consumer.name === 'pdfmark' &&
  consumer.children && consumer.children.length === 3
outlineOk ? (pass++, console.log('PASS  outline: pdfmark symbol keeps 3 collected children')) : (fail++, console.log('FAIL  outline:', JSON.stringify(r.symbols)))

// immediate-name equivalence, measured rather than argued: gs must produce the
// same operand-stack effect for `//x` and `x`. This is the evidence behind
// normalizing the `//` prefix before the table lookup.
function gsStdout(snippet) {
  const f = path.join(os.tmpdir(), 'ps-parity-stdout.ps')
  fs.writeFileSync(f, snippet + '\nquit\n')
  try {
    return execFileSync(GS, ['-q', '-dNODISPLAY', '-dBATCH', '-dNOPAUSE', f], { encoding: 'utf8', timeout: 15000 }).trim()
  } catch (e) {
    return String(e.stdout || '').trim()
  }
}
const equivalentPairs = [
  { label: 'cleartomark', bare: 'mark 1 2 3 cleartomark count ==', immediate: 'mark 1 2 3 //cleartomark count ==' },
  { label: '.dicttomark', bare: 'mark /a 1 /b 2 .dicttomark type ==', immediate: 'mark /a 1 /b 2 //.dicttomark type ==' },
  { label: 'clear', bare: '1 2 3 clear count ==', immediate: '1 2 3 //clear count ==' },
]
for (const p of equivalentPairs) {
  const a = gsStdout(p.bare)
  const b = gsStdout(p.immediate)
  const ok = a !== '' && a === b
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  gs: //${p.label} == ${p.label}  (bare=${JSON.stringify(a)} immediate=${JSON.stringify(b)})`)
}

console.log(`\n${pass} passed, ${fail} failed (gs: ${GS})`)
process.exit(fail > 0 ? 1 : 0)
