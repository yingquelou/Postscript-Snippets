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
      ['cleartomark', 'pdfmark']
    )
  })

  it('packedarray is not a default consumer: its signature takes an explicit count', () => {
    // gs accepts a mark form (`mark 1 2 3 packedarray` → one packed array,
    // the mark consumed), but the operator's primary signature is
    // `any0…any(n-1) n packedarray` — no mark involved. Static analysis
    // cannot know the mark form is intended, so without an explicit
    // declaration the leftover mark is reported and L3 grading settles it.
    const result = parsePostScript('mark 1 2 3 packedarray')
    assert.ok(result.errors.length > 0, 'packedarray must not consume by default')
    const configured = new PostScriptSymbolBuilder({
      consuming: [...DEFAULT_MARK_OPERATORS.consuming, 'packedarray'],
      suspending: DEFAULT_MARK_OPERATORS.suspending
    }).parse('mark 1 2 3 packedarray')
    assert.strictEqual(configured.errors.length, 0,
      `declared packedarray must consume: ${JSON.stringify(configured.errors)}`)
    assert.strictEqual(configured.symbols[0].name, 'packedarray')
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

describe('immediate names (//name) match the mark tables', () => {
  // gs 10.08: `mark 1 2 //cleartomark` and `mark 1 2 cleartomark` both leave
  // `count` 0 — an immediate name denotes the same operator, so a table entry
  // written as a plain name must match it.
  it('//cleartomark consumes the mark like cleartomark', () => {
    const result = parsePostScript('mark 1 2 //cleartomark')
    assert.strictEqual(result.errors.length, 0, `expected no errors, got: ${JSON.stringify(result.errors)}`)
    assert.strictEqual(result.symbols.length, 1)
    assert.strictEqual(result.symbols[0].name, '//cleartomark')
    assert.strictEqual(result.symbols[0].children!.length, 2)
  })

  it('//pdfmark consumes the mark like pdfmark', () => {
    const result = parsePostScript('[ /Title (x) /DOCINFO //pdfmark')
    assert.strictEqual(result.errors.length, 0, `expected no errors, got: ${JSON.stringify(result.errors)}`)
    assert.strictEqual(result.symbols[0].name, '//pdfmark')
  })

  it('//clear suspends pending marks like clear', () => {
    const result = parsePostScript('[ 1 2 3 //clear')
    assert.strictEqual(result.errors.length, 0, `expected no errors, got: ${JSON.stringify(result.errors)}`)
  })

  it('a configured alias matches through its immediate-name form', () => {
    // the shape used by gs' own pdfwrite: `mark (msg) //error exec`
    const builder = new PostScriptSymbolBuilder({
      consuming: [...DEFAULT_MARK_OPERATORS.consuming, '.dicttomark'],
      suspending: DEFAULT_MARK_OPERATORS.suspending
    })
    const result = builder.parse('mark /a 1 //.dicttomark')
    assert.strictEqual(result.errors.length, 0, `expected no errors, got: ${JSON.stringify(result.errors)}`)
    assert.strictEqual(result.symbols[0].name, '//.dicttomark')
  })

  it('still reports an immediate name that is not in the tables', () => {
    const result = parsePostScript('mark 1 2 //someop')
    assert.ok(result.errors.length > 0, 'unknown immediate name must not consume the mark')
  })

  it('a bare // (empty name) does not match an empty table entry', () => {
    const builder = new PostScriptSymbolBuilder({ consuming: [''], suspending: [] })
    const result = builder.parse('mark 1 2 //')
    assert.ok(result.errors.length > 0, 'empty name must not be treated as a consumer')
  })

  it('a literal name //-prefixed inside a string is not a token', () => {
    const result = parsePostScript('(//cleartomark) mark 1 2')
    assert.ok(result.errors.length > 0, 'text inside a string must not consume the mark')
  })
})
