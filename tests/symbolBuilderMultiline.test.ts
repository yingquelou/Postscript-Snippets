import { describe, it } from 'node:test'
import * as assert from 'node:assert'
import { parsePostScript } from '../out/language-server/symbolBuilder.js'

describe('symbolBuilder multiline string parsing', () => {
  it('parses single-line string correctly', () => {
    const text = '(Hello World)'
    const result = parsePostScript(text)
    
    assert.strictEqual(result.errors.length, 0)
    assert.strictEqual(result.symbols.length, 1)
    assert.strictEqual(result.symbols[0].name, '(Hello World)')
  })

  it('parses multiline string correctly', () => {
    const text = '(line1\nline2\nline3)'
    const result = parsePostScript(text)
    
    assert.strictEqual(result.errors.length, 0)
    assert.strictEqual(result.symbols.length, 1)
    assert.strictEqual(result.symbols[0].name, '(line1\nline2\nline3)')
  })

  it('parses procedure with multiline content correctly', () => {
    const text = '{\n(line1\nline2)\n}'
    const result = parsePostScript(text)
    
    assert.strictEqual(result.errors.length, 0)
    assert.strictEqual(result.symbols.length, 1)
    assert.ok(result.symbols[0].name.includes('procedure'))
  })
})