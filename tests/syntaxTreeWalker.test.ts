import { describe, it } from 'node:test'
import * as assert from 'node:assert'
import { psParserHelper } from '@/parser/postscriptParser'
import { CstWalker } from '@/parser/syntaxTreeWalker'

describe('SyntaxTreeWalker', () => {
  it('should correctly walk through CST nodes', () => {
    const programText = 'sd {12} (23)'

    // 使用新的实例化解析器模式，无全局单例
    const parseResult = psParserHelper(programText)
    if (parseResult.errors && parseResult.errors.length > 0) {
      assert.fail('Parser failed: ' + JSON.stringify(parseResult.errors))
    }
    const cst = parseResult.cst!

    const walker = new CstWalker(cst, programText)

    assert.strictEqual(walker.getCurrentNodeText(), 'sd')
    assert.strictEqual(walker.step(), true)
    assert.strictEqual(walker.getCurrentNodeText(), '{12}')

    const savedState = walker.saveState()
    assert.strictEqual(savedState.index, 1)

    assert.strictEqual(walker.step(), true)
    assert.strictEqual(walker.getCurrentNodeText(), '(23)')

    walker.rollback(savedState)
    assert.strictEqual(walker.getCurrentNodeText(), '{12}')
    assert.strictEqual(walker.step(), true)
    assert.strictEqual(walker.getCurrentNodeText(), '(23)')
  })

  it('should handle empty document correctly', () => {
    const parseResult = psParserHelper('')
    const cst = parseResult.cst!

    const walker = new CstWalker(cst, '')
    assert.strictEqual(walker.step(), false)
    assert.strictEqual(walker.getCurrentNodeText(), '')
  })

  it('should handle nested structures correctly', () => {
    const programText = '1 2 { 3 4 add } bind'
    const parseResult = psParserHelper(programText)
    if (parseResult.errors && parseResult.errors.length > 0) {
      assert.fail('Parser failed: ' + JSON.stringify(parseResult.errors))
    }
    const cst = parseResult.cst!

    const walker = new CstWalker(cst, programText)
    const nodes: string[] = []

    while (walker.step()) {
      nodes.push(walker.getCurrentNodeText())
    }

    assert.deepStrictEqual(nodes, ['1', '2', '{ 3 4 add }', 'bind'])
  })
})