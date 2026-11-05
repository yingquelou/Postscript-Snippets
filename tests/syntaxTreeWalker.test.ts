import { describe, it } from 'node:test'
import * as assert from 'node:assert'
import { psParserHelper } from '../out/parser/postscriptParser.js'
import { CstWalker } from '../out/parser/syntaxTreeWalker.js'

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
    // step() returns the consumed token text (not a boolean)
    assert.strictEqual(walker.step(), 'sd')
    assert.strictEqual(walker.getCurrentNodeText(), '{12}')

    const savedState = walker.saveState()
    assert.strictEqual(savedState.index, 1)

    assert.strictEqual(walker.step(), '{12}')
    assert.strictEqual(walker.getCurrentNodeText(), '(23)')

    walker.rollback(savedState)
    assert.strictEqual(walker.getCurrentNodeText(), '{12}')
    assert.strictEqual(walker.step(), '{12}')
    assert.strictEqual(walker.getCurrentNodeText(), '(23)')
  })

  it('should handle empty document correctly', () => {
    const parseResult = psParserHelper('')
    const cst = parseResult.cst!

    const walker = new CstWalker(cst, '')
    assert.strictEqual(walker.step(), '')
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

    // collect the text returned by each step (getCurrentNodeText reads ahead)
    for (let text = walker.step(); text; text = walker.step()) {
      nodes.push(text)
    }

    assert.deepStrictEqual(nodes, ['1', '2', '{ 3 4 add }', 'bind'])
  })
})