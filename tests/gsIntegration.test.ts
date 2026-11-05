import { describe, it } from 'node:test'
import * as assert from 'node:assert'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  parseGsErrorOutput,
  byteOffsetToCharOffset,
  escapePsString,
  parseTraceStderr,
  parseResidueOutput,
  parseGsErrorReport,
  parseGsDone,
  buildGsErrorHandler,
  buildDoneSentinel,
  makeRunNonce,
  gsErrorMarker,
  gsDoneMarker,
  classifyGsRun,
  RESIDUE_PROBE,
  RESIDUE_MARKER,
  TRACE_MARKER
} from '../out/gsParsers.js'

// real gs 10.08 output captured from: printf 'foo pop\n/bar undefinedop\n' | gs file
const REAL_GS_OUTPUT = `Error: /undefined in foo
Operand stack:

Execution stack:
   %interp_exit   .runexec2   --nostringval--   false   1   %stopped_push
Dictionary stack:
   --dict:735/1123(ro)(G)--   --dict:0/20(G)--   --dict:85/211(L)--
Current allocation mode is local
Current file position is 4
`

describe('parseGsErrorOutput', () => {
  it('parses errorname, command and position from real gs output', () => {
    const info = parseGsErrorOutput(REAL_GS_OUTPUT)
    assert.ok(info)
    assert.strictEqual(info!.errorname, 'undefined')
    assert.strictEqual(info!.command, 'foo')
    assert.strictEqual(info!.position, 4)
  })

  it('returns undefined for clean output', () => {
    assert.strictEqual(parseGsErrorOutput('GPL Ghostscript 10.08.0\n'), undefined)
  })

  it('returns position only when the error header is missing', () => {
    const info = parseGsErrorOutput('Current file position is 201')
    assert.ok(info)
    assert.strictEqual(info!.position, 201)
    assert.strictEqual(info!.errorname, undefined)
  })

  it('matches Error: line anywhere in the output (multiline)', () => {
    const info = parseGsErrorOutput('GPL Ghostscript 10.08.0: Unrecoverable error, exit code 1\nError: /unmatchedmark in --execute--\n')
    assert.ok(info)
    assert.strictEqual(info!.errorname, 'unmatchedmark')
    assert.strictEqual(info!.command, '--execute--')
  })
})

describe('byteOffsetToCharOffset', () => {
  it('passes ASCII offsets through unchanged', () => {
    assert.strictEqual(byteOffsetToCharOffset('foo pop\n', 4), 4)
    assert.strictEqual(byteOffsetToCharOffset('foo pop\n', 0), 0)
  })

  it('clamps beyond the end', () => {
    assert.strictEqual(byteOffsetToCharOffset('abc', 999), 3)
  })

  it('maps byte offsets through multibyte characters (UTF-8 → UTF-16)', () => {
    // "中文" = 6 UTF-8 bytes, 2 UTF-16 chars
    const text = '中文 foo'
    assert.strictEqual(byteOffsetToCharOffset(text, 0), 0)
    assert.strictEqual(byteOffsetToCharOffset(text, 3), 1)   // inside 中 → snapped to its end
    assert.strictEqual(byteOffsetToCharOffset(text, 6), 2)   // after both CJK chars
    assert.strictEqual(byteOffsetToCharOffset(text, 7), 3)   // after the space
  })

  it('handles astral-plane characters (UTF-16 surrogate pairs)', () => {
    // 𝕏 is 4 UTF-8 bytes, 2 UTF-16 code units
    const text = '𝕏 ok'
    assert.strictEqual(byteOffsetToCharOffset(text, 4), 2)
  })

  it('full L3 chain: gs pos (1-based, at terminating whitespace) → token end', () => {
    // real gs 10.08 calibration: "foo pop\n" with foo at byte 0 → position 4
    const text = 'foo pop\n'
    const gsPosition = 4
    const charOffset = byteOffsetToCharOffset(text, gsPosition - 1) // 0-based byte index
    assert.strictEqual(charOffset, 3)                // whitespace index == token exclusive end
    assert.strictEqual(text.slice(charOffset - 3, charOffset), 'foo')
    assert.ok(/\s/.test(text[charOffset]))
  })
})

describe('escapePsString', () => {
  it('converts backslashes to forward slashes', () => {
    assert.strictEqual(escapePsString('C:\\repo\\lib.ps'), 'C:/repo/lib.ps')
  })

  it('escapes PostScript string delimiters', () => {
    assert.strictEqual(escapePsString('a(b)c'), 'a\\(b\\)c')
  })
})

describe('parseTraceStderr', () => {
  it('extracts file names in execution order from real trace output', () => {
    const stderr = `${TRACE_MARKER}top.ps\nouter done\ninner done\n${TRACE_MARKER}lib.ps\n${TRACE_MARKER}main.ps\r\n`
    assert.deepStrictEqual(parseTraceStderr(stderr), ['top.ps', 'lib.ps', 'main.ps'])
  })

  it('returns an empty list for a clean run without trace lines', () => {
    assert.deepStrictEqual(parseTraceStderr('nothing here\n'), [])
  })
})

const GS_BIN = ['gswin64c', 'gs'].find(candidate => {
  try {
    return spawnSync(candidate, ['--version'], { stdio: 'pipe', timeout: 15000 }).status === 0
  } catch {
    return false
  }
})

describe('mark residue probe (L3)', () => {
  it('reports the operands above an unclosed mark', () => {
    assert.strictEqual(parseResidueOutput(`${RESIDUE_MARKER}3\n`), 3)
  })

  it('reports 0 when the probe ran and no mark was left', () => {
    assert.strictEqual(parseResidueOutput(`${RESIDUE_MARKER} none`), 0)
  })

  it('returns undefined when the probe did not run', () => {
    assert.strictEqual(parseResidueOutput('GPL Ghostscript 10.08.0\n'), undefined)
  })

  it('gs agrees: unclosed [ reports its payload, closed [ reports none', () => {
    if (!GS_BIN) return
    const cases: Array<[string, number]> = [
      ['[ 1 2 3', 3],
      ['[ 1 2 cleartomark', 0],
      ['1 2 3', 0],
      ['[ 1 2 3 ]', 0]
    ]
    for (const [snippet, expected] of cases) {
      const file = path.join(os.tmpdir(), `ps-residue-${process.pid}-${Date.now()}.ps`)
      fs.writeFileSync(file, snippet + RESIDUE_PROBE)
      const run: any = spawnSync(GS_BIN, ['-q', '-dNODISPLAY', '-dBATCH', '-dNOPAUSE', file], { stdio: 'pipe', timeout: 20000 })
      const output: string = `${String(run.stdout)}${String(run.stderr)}`
      assert.strictEqual(parseResidueOutput(output), expected, `snippet ${JSON.stringify(snippet)} → ${output}`)
      fs.unlinkSync(file)
    }
  })
})

describe('structured error hook hardening', () => {
  it('resolves $error at scan time and touches no other dictionary name', () => {
    const src = buildGsErrorHandler()
    assert.ok(src.includes('//$error'), 'the handler must use the immediate name')
    // every remaining $error must be the immediate form: a bare `$error`
    // would resolve through the dictionary stack and a `/$error 5 def` in the
    // validated file would break the hook.
    assert.ok(!/[\s(]\$error/.test(src.replace(/\/\/\$error/g, '')), src)
  })

  it('accepts a report only when the per-run nonce matches', () => {
    const nonce = 'abc123'
    const forged = `${'===GS-ERROR==='} name=/forged\n`
    assert.strictEqual(parseGsErrorReport(forged, gsErrorMarker(nonce)), undefined)
    const real = `${gsErrorMarker(nonce)} name=/unmatchedmark\n`
    assert.strictEqual(parseGsErrorReport(real, gsErrorMarker(nonce))?.errorname, 'unmatchedmark')
    // a no-nonce report is still readable (build trace path)
    assert.strictEqual(parseGsErrorReport(`${'===GS-ERROR==='} name=/x\n`)?.errorname, 'x')
  })

  it('embeds the nonce in the completion sentinel', () => {
    assert.ok(buildDoneSentinel('zz9').includes(gsDoneMarker('zz9')))
    assert.ok(!parseGsDone(buildDoneSentinel('aa1'), gsDoneMarker('bb2')))
    assert.ok(parseGsDone(`noise\n${buildDoneSentinel('aa1')}\n`, gsDoneMarker('aa1')))
  })
})

describe('classifyGsRun', () => {
  const nonce = 'n0nce1'
  const done = gsDoneMarker(nonce)

  it('calls a run clean only when the sentinel ran', () => {
    const outcome = classifyGsRun({ exitCode: 0, output: `${done}\n${RESIDUE_MARKER} none`, nonce })
    assert.deepStrictEqual(outcome, { kind: 'clean', residue: 0 })
  })

  it('treats exit 0 without the sentinel as incomplete, not clean', () => {
    assert.deepStrictEqual(classifyGsRun({ exitCode: 0, output: '(before-quit)\n', nonce }), { kind: 'incomplete' })
  })

  it('prefers the structured report', () => {
    const output = `${gsErrorMarker(nonce)} name=/unmatchedmark\n${gsErrorMarker(nonce)} position=5`
    const outcome = classifyGsRun({ exitCode: 1, output, nonce })
    assert.strictEqual(outcome.kind, 'error')
    assert.strictEqual((outcome as any).report.errorname, 'unmatchedmark')
    assert.strictEqual((outcome as any).report.position, 5)
  })

  it('falls back to the human-readable block', () => {
    const output = 'Error: /undefined in foo\nCurrent file position is 4\n'
    const outcome = classifyGsRun({ exitCode: 1, output, nonce })
    assert.strictEqual(outcome.kind, 'error-text')
    assert.strictEqual((outcome as any).info.errorname, 'undefined')
  })

  it('reports a failure with no attribution when the hook was replaced', () => {
    const output = 'GPL Ghostscript 10.08.0: Unrecoverable error, exit code 1\n'
    assert.deepStrictEqual(classifyGsRun({ exitCode: 1, output, nonce }), {
      kind: 'error-unattributed',
      exitCode: 1
    })
  })

  it('separates an interpreter crash from a PostScript error', () => {
    const output = 'Unrecoverable error: typecheck in get\nUnexpected interpreter error -20.\n'
    const outcome = classifyGsRun({ exitCode: 255, output, nonce })
    assert.strictEqual(outcome.kind, 'crash')
    assert.match((outcome as any).detail, /Unexpected interpreter error/)
  })
})

describe('hook vs. program interference (real gs)', () => {
  const runLikeValidate = (snippet: string) => {
    const nonce = makeRunNonce()
    const file = path.join(os.tmpdir(), `ps-hook-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.ps`)
    fs.writeFileSync(file, snippet + RESIDUE_PROBE, 'utf8')
    const run: any = spawnSync(
      GS_BIN as string,
      [
        '-q', '-dNODISPLAY', '-dBATCH', '-dNOPAUSE',
        '-c', buildGsErrorHandler(nonce),
        '-f', file,
        '-c', buildDoneSentinel(nonce)
      ],
      { stdio: 'pipe', timeout: 20000, encoding: 'utf8' }
    )
    const output: string = `${String(run.stdout)}${String(run.stderr)}`
    fs.unlinkSync(file)
    return classifyGsRun({ exitCode: Number(run.status), output, nonce })
  }

  it('survives redefinitions of print, systemdict and errordict', () => {
    if (!GS_BIN) return
    const outcome = runLikeValidate('/print { (X) = } def /systemdict 5 def /errordict 5 def\n1 2 ]\n')
    assert.strictEqual(outcome.kind, 'error')
    assert.strictEqual((outcome as any).report.errorname, 'unmatchedmark')
  })

  it('ignores a marker forged by the program', () => {
    if (!GS_BIN) return
    const outcome = runLikeValidate('(===GS-ERROR=== name=/forged) print\n1 2 ]\n')
    assert.strictEqual(outcome.kind, 'error')
    assert.strictEqual((outcome as any).report.errorname, 'unmatchedmark')
  })

  it('reports an unattributable failure when handleerror is replaced', () => {
    if (!GS_BIN) return
    const outcome = runLikeValidate('errordict /handleerror { (USER) = } put\n1 2 ]\n')
    assert.strictEqual(outcome.kind, 'error-unattributed')
  })

  it('marks a quit-terminated run incomplete instead of clean', () => {
    if (!GS_BIN) return
    const outcome = runLikeValidate('(before) =\nquit\n1 2 ]\n')
    assert.strictEqual(outcome.kind, 'incomplete')
  })

  it('still reports a clean run as clean', () => {
    if (!GS_BIN) return
    const outcome = runLikeValidate('(ok) =\n')
    assert.strictEqual(outcome.kind, 'clean')
    assert.strictEqual((outcome as any).residue, 0)
  })
})
