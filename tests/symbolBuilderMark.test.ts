import { describe, it } from 'node:test'
import * as assert from 'node:assert'
import { parsePostScript, PostScriptSymbolBuilder, DEFAULT_MARK_OPERATORS } from '../out/language-server/symbolBuilder.js'

describe('symbolBuilder mark-aware operators (issue #2)', () => {
  it('does not report [ ... pdfmark as unclosed array', () => {
    const result = parsePostScript('[ /Title (x) /DOCINFO pdfmark')
    assert.strictEqual(result.errors.length, 0, `expected no errors, got: ${JSON.stringify(result.errors)}`)
  })

  it('does not report [ 1 2 3 cleartomark as unclosed array', () => {
    const result = parsePostScript('[ 1 2 3 cleartomark')
    assert.strictEqual(result.errors.length, 0, `expected no errors, got: ${JSON.stringify(result.errors)}`)
  })

  it('attaches collected content to the consuming operator symbol', () => {
    const result = parsePostScript('[ 1 2 3 cleartomark')
    assert.strictEqual(result.symbols.length, 1)
    const consumer = result.symbols[0]
    assert.strictEqual(consumer.name, 'cleartomark')
    assert.ok(consumer.children && consumer.children.length === 3,
      `expected 3 children, got: ${JSON.stringify(consumer.children)}`)
    assert.strictEqual(consumer.children![0].name, '1')
    assert.strictEqual(consumer.children![2].name, '3')
  })

  it('does not report mark ... cleartomark as orphan mark', () => {
    const result = parsePostScript('mark 1 2 3 cleartomark')
    assert.strictEqual(result.errors.length, 0, `expected no errors, got: ${JSON.stringify(result.errors)}`)
  })

  it('still reports a genuinely unclosed array', () => {
    const result = parsePostScript('[ 1 2 3')
    assert.ok(result.errors.length > 0, 'unclosed array should be reported')
  })

  it('still reports an orphan mark without a consumer', () => {
    const result = parsePostScript('mark 1 2 3')
    assert.ok(result.errors.length > 0, 'orphan mark should be reported')
  })

  it('drops pending marks silently after a suspending operator', () => {
    const result = parsePostScript('[ 1 2 3 clear')
    assert.strictEqual(result.errors.length, 0, `expected no errors, got: ${JSON.stringify(result.errors)}`)
  })

  it('consumption does not cross a procedure boundary', () => {
    // the mark lives outside the procedure; cleartomark inside must not consume it
    const result = parsePostScript('[ 1 { 2 cleartomark } ]')
    assert.ok(result.errors.length === 0, `expected no errors, got: ${JSON.stringify(result.errors)}`)
    // the array stays open at end of input? no: it is closed by ] — balanced
  })

  it('a literal name /pdfmark never matches the consuming table', () => {
    const result = parsePostScript('[ /pdfmark')
    assert.ok(result.errors.length > 0, 'literal name must not consume the mark')
  })

  it('counttomark is not a consumer by default', () => {
    const result = parsePostScript('[ 1 2 counttomark')
    assert.ok(result.errors.length > 0, 'counttomark must not consume the mark')
  })

  it('the default tables hold only operators gs actually has', () => {
    // `clearstack` is a Level 1 legacy name gs never implemented
    // (10.08: `1 2 3 clearstack` → /undefined in clearstack). An entry that can
    // never match is worse than none: it advertises support that is not there.
    assert.deepStrictEqual(DEFAULT_MARK_OPERATORS.suspending, ['clear'])
    assert.deepStrictEqual(
      DEFAULT_MARK_OPERATORS.consuming,
      ['cleartomark', 'packedarray', 'pdfmark']
    )
  })

  it('packedarray consumes the mark like gs does', () => {
    // gs 10.08: `mark 1 2 3 packedarray` → one packed array (count 1)
    const result = parsePostScript('mark 1 2 3 packedarray')
    assert.strictEqual(result.errors.length, 0, `expected no errors, got: ${JSON.stringify(result.errors)}`)
    assert.strictEqual(result.symbols.length, 1)
    assert.strictEqual(result.symbols[0].name, 'packedarray')
  })

  it('array takes an int size and leaves the mark pending (gs parity)', () => {
    // gs 10.08: `mark 1 2 3 array` keeps the mark on the stack
    const result = parsePostScript('mark 1 2 3 array')
    assert.ok(result.errors.length > 0, 'array is not a mark consumer')
  })

  it('custom operator tables can be injected', () => {
    const builder = new PostScriptSymbolBuilder({
      consuming: ['myop'],
      suspending: DEFAULT_MARK_OPERATORS.suspending
    })
    const result = builder.parse('[ 1 2 3 myop')
    assert.strictEqual(result.errors.length, 0, `expected no errors, got: ${JSON.stringify(result.errors)}`)
    assert.strictEqual(result.symbols.length, 1)
    assert.strictEqual(result.symbols[0].name, 'myop')
  })

  it('empty suspending table restores orphan-mark warnings', () => {
    const builder = new PostScriptSymbolBuilder({
      consuming: DEFAULT_MARK_OPERATORS.consuming,
      suspending: []
    })
    const result = builder.parse('[ 1 2 3 clear')
    assert.ok(result.errors.length > 0, 'orphan mark should be reported when suspending table is empty')
  })
})
