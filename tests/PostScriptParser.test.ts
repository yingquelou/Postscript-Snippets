import { describe, it } from 'node:test'
import * as assert from 'node:assert'
import { PsStrictLexer } from '../out/parser/postscriptParser.js'
import { buildPostScriptSymbols } from '../out/language-server/symbolBuilder.js'

const SAMPLE = `%!PS-Adobe-3.0
/box {
  /y exch def /x exch def
  0 0 moveto
  x y lineto
  stroke
} bind def
/Times-Roman findfont 12 scalefont setfont
(Hello) show
`

describe('parser + symbol builder pipeline', () => {
  it('lexes a realistic program without errors', () => {
    const result = PsStrictLexer.tokenize(SAMPLE)
    assert.strictEqual(result.errors.length, 0)
    assert.ok(result.tokens.length > 20)
    // the leading magic comment is consumed as a comment, not a token
    assert.ok(!result.tokens.some((t: any) => t.image.startsWith('%!')))
  })

  it('builds an outline with the procedure and top-level calls', () => {
    const symbols = buildPostScriptSymbols(SAMPLE)
    assert.ok(symbols.length > 0)
    // the procedure body is outlined as {...}
    assert.ok(symbols.some(s => s.name === '{...}'))
  })

  it('keeps symbol ranges inside the source text', () => {
    const text = '/radius 10 def { radius } def'
    const result = PsStrictLexer.tokenize(text)
    assert.strictEqual(result.errors.length, 0)
    const symbols = buildPostScriptSymbols(text)
    assert.ok(symbols.length >= 1)
    const lineCount = text.split('\n').length
    for (const s of symbols) {
      assert.ok(s.range.end.line < lineCount)
      assert.ok(s.range.start.line >= 0)
    }
  })
})
