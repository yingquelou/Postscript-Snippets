import { describe, it } from 'node:test'
import * as assert from 'node:assert'
import { PsStrictLexer } from '../out/parser/postscriptParser'
import { PostScriptSymbolBuilder } from '../out/language-server/symbolBuilder'

function runBenchmark(name: string, fn: () => void, iterations: number = 100): number {
  const start = performance.now()
  for (let i = 0; i < iterations; i++) {
    fn()
  }
  const end = performance.now()
  const totalMs = end - start
  const avgMs = totalMs / iterations
  console.log(`${name}: ${avgMs.toFixed(4)}ms avg (${totalMs.toFixed(2)}ms total for ${iterations} iterations)`)
  return avgMs
}

describe('PostScript Symbol Builder Performance', () => {
  it('should handle deeply nested marked arrays efficiently', () => {
    const depth = 100
    const psCode = 'mark ' + '1 '.repeat(depth - 1) + ']' + ' ]'.repeat(depth - 1)
    
    const avgMs = runBenchmark('Deeply nested marked array (depth=100)', () => {
      const result = PsStrictLexer.tokenize(psCode)
      const builder = new PostScriptSymbolBuilder()
      builder.parseFromTokens(result.tokens, psCode)
    }, 50)
    
    assert.ok(avgMs < 100, `Should complete in under 100ms, took ${avgMs.toFixed(2)}ms`)
  })

  it('should handle deeply nested explicit arrays efficiently', () => {
    const depth = 100
    const psCode = '[' + '[ '.repeat(depth - 1) + '1 ' + ']'.repeat(depth)
    
    const avgMs = runBenchmark('Deeply nested explicit arrays (depth=100)', () => {
      const result = PsStrictLexer.tokenize(psCode)
      const builder = new PostScriptSymbolBuilder()
      builder.parseFromTokens(result.tokens, psCode)
    }, 50)
    
    assert.ok(avgMs < 100, `Should complete in under 100ms, took ${avgMs.toFixed(2)}ms`)
  })

  it('should handle large number of tokens efficiently', () => {
    const tokenCount = 1000
    const psCode = '[ ' + '1 2 3 4 5 '.repeat(Math.floor(tokenCount / 5)) + ']'
    
    const avgMs = runBenchmark(`Large file (${tokenCount} tokens)`, () => {
      const result = PsStrictLexer.tokenize(psCode)
      const builder = new PostScriptSymbolBuilder()
      builder.parseFromTokens(result.tokens, psCode)
    }, 50)
    
    assert.ok(avgMs < 100, `Should complete in under 100ms, took ${avgMs.toFixed(2)}ms`)
  })

  it('should handle mixed nested structures efficiently', () => {
    const iterations = 50
    const psCode = 'mark /key << /nested [ /inner ] >> ]'
    
    const avgMs = runBenchmark('Mixed nested structures', () => {
      const result = PsStrictLexer.tokenize(psCode)
      const builder = new PostScriptSymbolBuilder()
      builder.parseFromTokens(result.tokens, psCode)
    }, iterations)
    
    assert.ok(avgMs < 10, `Should complete in under 10ms, took ${avgMs.toFixed(2)}ms`)
  })

  it('should handle many sibling marked containers efficiently', () => {
    const count = 100
    const psCode = Array(count).fill(null).map((_, i) => `mark ${i} ]`).join(' ')
    
    const avgMs = runBenchmark(`Many sibling marked containers (count=${count})`, () => {
      const result = PsStrictLexer.tokenize(psCode)
      const builder = new PostScriptSymbolBuilder()
      builder.parseFromTokens(result.tokens, psCode)
    }, 50)
    
    assert.ok(avgMs < 50, `Should complete in under 50ms, took ${avgMs.toFixed(2)}ms`)
  })

  it('should generate correct symbols for nested structures', () => {
    const psCode = '[[[/deep ]]]'
    const result = PsStrictLexer.tokenize(psCode)
    const builder = new PostScriptSymbolBuilder()
    const parseResult = builder.parseFromTokens(result.tokens, psCode)
    
    assert.ok(parseResult.symbols.length > 0, 'Should have symbols')
    
    const arraySymbols = parseResult.symbols
    assert.ok(arraySymbols.length >= 4, `Should have at least 4 array symbols, got ${arraySymbols.length}`)
  })
})