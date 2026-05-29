import { describe, it } from 'node:test'
import * as assert from 'node:assert'
import { PsStrictLexer } from '../out/parser/postscriptParser'

describe('PostScript Lexer', () => {
  it('should correctly tokenize mark keyword', () => {
    const result = PsStrictLexer.tokenize('mark')
    assert.strictEqual(result.errors.length, 0, 'Should have no errors')
    assert.strictEqual(result.tokens.length, 1, 'Should have exactly 1 token')
    assert.strictEqual(result.tokens[0].tokenType.name, 'Mark', 'mark should be tokenized as Mark token')
    assert.strictEqual(result.tokens[0].image, 'mark', 'Image should be "mark"')
  })

  it('should correctly tokenize mark in marked array', () => {
    const result = PsStrictLexer.tokenize('mark 1 2 ]')
    assert.strictEqual(result.errors.length, 0, 'Should have no errors')
    assert.strictEqual(result.tokens.length, 4, 'Should have 4 tokens')
    assert.strictEqual(result.tokens[0].tokenType.name, 'Mark', 'First token should be Mark')
    assert.strictEqual(result.tokens[3].tokenType.name, 'ArrayEnd', 'Last token should be ArrayEnd')
  })

  it('should correctly tokenize mark in marked dictionary', () => {
    const result = PsStrictLexer.tokenize('mark /key /value >>')
    assert.strictEqual(result.errors.length, 0, 'Should have no errors')
    assert.strictEqual(result.tokens.length, 4, 'Should have 4 tokens')
    assert.strictEqual(result.tokens[0].tokenType.name, 'Mark', 'First token should be Mark')
    assert.strictEqual(result.tokens[1].tokenType.name, 'LiteralName', 'Second token should be LiteralName')
    assert.strictEqual(result.tokens[3].tokenType.name, 'DictEnd', 'Last token should be DictEnd')
  })

  it('should distinguish mark from executable name', () => {
    const result = PsStrictLexer.tokenize('mark add')
    assert.strictEqual(result.errors.length, 0, 'Should have no errors')
    assert.strictEqual(result.tokens.length, 2, 'Should have 2 tokens')
    assert.strictEqual(result.tokens[0].tokenType.name, 'Mark', 'First token should be Mark')
    assert.strictEqual(result.tokens[1].tokenType.name, 'ExecutableName', 'Second token should be ExecutableName')
  })

  it('should handle nested marked structures', () => {
    const result = PsStrictLexer.tokenize('mark mark 1 ] ]')
    assert.strictEqual(result.errors.length, 0, 'Should have no errors')
    assert.strictEqual(result.tokens.length, 5, 'Should have 5 tokens')
    assert.strictEqual(result.tokens[0].tokenType.name, 'Mark', 'First token should be Mark')
    assert.strictEqual(result.tokens[1].tokenType.name, 'Mark', 'Second token should be Mark')
  })

  it('should correctly tokenize executable name "mark" in different context', () => {
    const result = PsStrictLexer.tokenize('dup mark eq')
    assert.strictEqual(result.errors.length, 0, 'Should have no errors')
    assert.strictEqual(result.tokens.length, 4, 'Should have 4 tokens')
    assert.strictEqual(result.tokens[2].tokenType.name, 'Mark', '"mark" in executable position should be Mark token')
  })

  describe('ExecutableName boundary cases', () => {
    it('should correctly tokenize operators with special characters', () => {
      const result = PsStrictLexer.tokenize('add sub mul div')
      assert.strictEqual(result.errors.length, 0, 'Should have no errors')
      assert.strictEqual(result.tokens.length, 4, 'Should have 4 tokens')
      result.tokens.forEach((token: any, i: number) => {
        assert.strictEqual(token.tokenType.name, 'ExecutableName', `Token ${i} should be ExecutableName`)
      })
    })

    it('should correctly tokenize operators with numbers', () => {
      const result = PsStrictLexer.tokenize('copy div mod')
      assert.strictEqual(result.errors.length, 0, 'Should have no errors')
      result.tokens.forEach((token: any) => {
        assert.strictEqual(token.tokenType.name, 'ExecutableName', 'Should be ExecutableName')
      })
    })

    it('should handle double slash as single token', () => {
      const result = PsStrictLexer.tokenize('//resourcestatus')
      assert.strictEqual(result.errors.length, 0, 'Should have no errors')
      assert.strictEqual(result.tokens.length, 1, 'Should have 1 token')
      assert.strictEqual(result.tokens[0].tokenType.name, 'ExecutableName', 'Should be ExecutableName')
    })

    it('should distinguish literal names from executable names', () => {
      const result = PsStrictLexer.tokenize('/mysymbol mysymbol')
      assert.strictEqual(result.errors.length, 0, 'Should have no errors')
      assert.strictEqual(result.tokens.length, 2, 'Should have 2 tokens')
      assert.strictEqual(result.tokens[0].tokenType.name, 'LiteralName', 'First should be LiteralName')
      assert.strictEqual(result.tokens[1].tokenType.name, 'ExecutableName', 'Second should be ExecutableName')
    })

    it('should correctly tokenize brackets as separate tokens', () => {
      const result = PsStrictLexer.tokenize('<< >> [ ] { }')
      assert.strictEqual(result.errors.length, 0, 'Should have no errors')
      assert.strictEqual(result.tokens.length, 8, 'Should have 8 tokens')
      assert.strictEqual(result.tokens[0].tokenType.name, 'DictStart', 'First should be DictStart')
      assert.strictEqual(result.tokens[1].tokenType.name, 'DictEnd', 'Second should be DictEnd')
      assert.strictEqual(result.tokens[2].tokenType.name, 'ArrayStart', 'Third should be ArrayStart')
      assert.strictEqual(result.tokens[3].tokenType.name, 'ArrayEnd', 'Fourth should be ArrayEnd')
      assert.strictEqual(result.tokens[4].tokenType.name, 'ProcedureStart', 'Fifth should be ProcedureStart')
      assert.strictEqual(result.tokens[5].tokenType.name, 'ProcedureEnd', 'Sixth should be ProcedureEnd')
    })

    it('should handle empty string as operator', () => {
      const result = PsStrictLexer.tokenize('dup 0 eq')
      assert.strictEqual(result.errors.length, 0, 'Should have no errors')
      assert.strictEqual(result.tokens.length, 3, 'Should have 3 tokens')
    })

    it('should correctly tokenize complex PostScript expressions', () => {
      const code = '/Font findfont 12 scalefont setfont'
      const result = PsStrictLexer.tokenize(code)
      assert.strictEqual(result.errors.length, 0, 'Should have no errors')
      assert.strictEqual(result.tokens[0].tokenType.name, 'LiteralName', 'First should be LiteralName')
      assert.strictEqual(result.tokens[1].tokenType.name, 'ExecutableName', 'Second should be ExecutableName')
    })
  })
})
