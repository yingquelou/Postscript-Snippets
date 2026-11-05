import { describe, it } from 'node:test'
import * as assert from 'node:assert'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  buildCompositionStream,
  parseComposition,
  isBalancedInContext,
  locateFragmentOffset
} from '../out/language-server/compositionAnalysis.js'
import { DEFAULT_MARK_OPERATORS } from '../out/language-server/symbolBuilder.js'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ps-comp-'))
}

describe('buildCompositionStream', () => {
  it('concatenates deps in order with the current file last', async () => {
    const dir = tmpDir()
    const a = path.join(dir, 'a.ps')
    const b = path.join(dir, 'b.ps')
    const main = path.join(dir, 'main.ps')
    fs.writeFileSync(a, '[ /Title (x)')
    fs.writeFileSync(b, 'mark 1')
    fs.writeFileSync(main, '2 3 ]')

    const { fragments, stream } = await buildCompositionStream(main, '2 3 ]', [a, b])
    assert.strictEqual(fragments.length, 3)
    assert.strictEqual(fragments[0].file, a)
    assert.strictEqual(fragments[2].file, main)
    // fragments are separated by a newline so tokens never fuse across files
    assert.strictEqual(fragments[1].startOffset, fragments[0].endOffset + 1)
    assert.strictEqual(stream, '[ /Title (x)\nmark 1\n2 3 ]')
  })

  it('never fuses the last token of a file with the first token of the next', async () => {
    const dir = tmpDir()
    const a = path.join(dir, 'a.ps')
    const main = path.join(dir, 'main.ps')
    fs.writeFileSync(a, '1')
    const { stream } = await buildCompositionStream(main, '2', [a])
    assert.strictEqual(stream, '1\n2')
  })

  it('does not add a separator when the previous file already ends with whitespace', async () => {
    const dir = tmpDir()
    const a = path.join(dir, 'a.ps')
    const main = path.join(dir, 'main.ps')
    fs.writeFileSync(a, '1\n')
    const { stream } = await buildCompositionStream(main, '2', [a])
    assert.strictEqual(stream, '1\n2')
  })

  it('skips the current file when listed as a dependency (no double load)', async () => {
    const dir = tmpDir()
    const main = path.join(dir, 'main.ps')
    fs.writeFileSync(main, 'x')
    const { fragments } = await buildCompositionStream(main, 'x', [main])
    assert.strictEqual(fragments.length, 1)
    assert.strictEqual(fragments[0].file, main)
  })

  it('skips missing dependency files without failing', async () => {
    const dir = tmpDir()
    const main = path.join(dir, 'main.ps')
    fs.writeFileSync(main, 'ok')
    const { fragments, stream } = await buildCompositionStream(main, 'ok', [path.join(dir, 'ghost.ps')])
    assert.strictEqual(fragments.length, 1)
    assert.strictEqual(stream, 'ok')
  })
})

describe('L1 cross-file mark balance (issue #2 engineering case)', () => {
  it('downgrades a cross-file ] to balanced-in-context', async () => {
    const dir = tmpDir()
    const a = path.join(dir, 'a.ps')       // opens the array
    const main = path.join(dir, 'main.ps') // closes it in another file
    fs.writeFileSync(a, '[ /Title (x)')
    fs.writeFileSync(main, '1 2 3 ]')

    const single = (() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { parsePostScript } = require('../out/language-server/symbolBuilder.js')
      return parsePostScript('1 2 3 ]')
    })()
    assert.ok(single.errors.length > 0, 'single-file view must flag the orphan ]')

    const { fragments, stream } = await buildCompositionStream(main, '1 2 3 ]', [a])
    const merged = parseComposition(stream, DEFAULT_MARK_OPERATORS)
    assert.strictEqual(merged.errors.length, 0, `merged stream balanced, got: ${JSON.stringify(merged.errors)}`)

    const docFragment = fragments[fragments.length - 1]
    const orphan = single.errors[0]
    assert.strictEqual(
      isBalancedInContext(merged, docFragment, orphan.startOffset),
      true,
      'warning must be detected as balanced in the build context'
    )
  })

  it('keeps the warning when the construct is unbalanced even merged', async () => {
    const dir = tmpDir()
    const a = path.join(dir, 'a.ps')
    const main = path.join(dir, 'main.ps')
    fs.writeFileSync(a, 'mark 1 2')          // mark never closed anywhere
    fs.writeFileSync(main, '3 ]')            // ] has nothing to match after the mark? it does match the mark!

    // use a truly unbalanced pair: two ] in main, one [ in dep
    fs.writeFileSync(a, '[ 1')
    fs.writeFileSync(main, '] ]')

    const { fragments, stream } = await buildCompositionStream(main, '] ]', [a])
    const merged = parseComposition(stream, DEFAULT_MARK_OPERATORS)
    assert.ok(merged.errors.length > 0, 'merged stream must still be unbalanced')

    const { parsePostScript } = require('../out/language-server/symbolBuilder.js')
    const single = parsePostScript('] ]')
    const docFragment = fragments[fragments.length - 1]
    const secondBracket = single.errors[single.errors.length - 1]
    assert.strictEqual(
      isBalancedInContext(merged, docFragment, secondBracket.startOffset),
      false,
      'unbalanced construct must not be downgraded'
    )
  })

  it('reports a merged-stream error anchored in the current document', async () => {
    const dir = tmpDir()
    const a = path.join(dir, 'a.ps')
    const main = path.join(dir, 'main.ps')
    fs.writeFileSync(a, '[ 1 2')
    fs.writeFileSync(main, '3')

    const { stream } = await buildCompositionStream(main, '3', [a])
    const merged = parseComposition(stream, DEFAULT_MARK_OPERATORS)
    assert.ok(merged.errors.length > 0, 'unclosed [ survives in the merged stream')
    // the anchor is inside the dependency fragment, not the current doc
    assert.ok(merged.errors[0].startOffset < '[ 1 2'.length)
  })
})

describe('locateFragmentOffset (L3 error attribution)', () => {
  it('maps a merged offset back to the owning file and local offset', async () => {
    const dir = tmpDir()
    const a = path.join(dir, 'a.ps')
    const main = path.join(dir, 'main.ps')
    fs.writeFileSync(a, '1 2')
    const { fragments } = await buildCompositionStream(main, '3 4', [a])

    const inDep = locateFragmentOffset(fragments, 1)
    assert.strictEqual(inDep?.file, a)
    assert.strictEqual(inDep?.localOffset, 1)

    const inDoc = locateFragmentOffset(fragments, fragments[1].startOffset + 2)
    assert.strictEqual(inDoc?.file, main)
    assert.strictEqual(inDoc?.localOffset, 2)
  })

  it('returns undefined for offsets outside every fragment', () => {
    assert.strictEqual(locateFragmentOffset([], 5), undefined)
  })
})
