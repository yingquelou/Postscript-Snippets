import { describe, it } from 'node:test'
import * as assert from 'node:assert'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { shouldDeferToSnippet } from '../out/language-server/completionUtils.js'
import { loadSnippetPrefixSet, normalizeSnippetPrefix } from '../out/language-server/snippetIndex.js'

describe('shouldDeferToSnippet', () => {
  const snippetPrefixes = new Set(['add', 'pop'])

  it('defers operator covered by snippet index', () => {
    assert.strictEqual(
      shouldDeferToSnippet({ name: 'add', type: 'operator' }, snippetPrefixes),
      true
    )
    assert.strictEqual(
      shouldDeferToSnippet({ name: '/add', type: 'operator' }, snippetPrefixes),
      true
    )
  })

  it('keeps non-operator entries', () => {
    assert.strictEqual(
      shouldDeferToSnippet({ name: 'myProc', type: 'name' }, snippetPrefixes),
      false
    )
  })

  it('keeps operators not in snippet index', () => {
    assert.strictEqual(
      shouldDeferToSnippet({ name: 'gspecificop', type: 'operator' }, snippetPrefixes),
      false
    )
  })
})

describe('normalizeSnippetPrefix', () => {
  it('strips leading slash and lowercases', () => {
    assert.strictEqual(normalizeSnippetPrefix('/Add'), 'add')
    assert.strictEqual(normalizeSnippetPrefix('POP'), 'pop')
  })
})

describe('loadSnippetPrefixSet', () => {
  it('loads prefixes from snippet-index.json', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-snippet-index-'))
    try {
      const index = {
        add: { body: '${1:num1} add', description: 'pushed:sum' },
        pop: { body: 'pop', description: '' }
      }
      fs.writeFileSync(path.join(tmpDir, 'snippet-index.json'), JSON.stringify(index))
      const prefixes = await loadSnippetPrefixSet(tmpDir)
      assert.strictEqual(prefixes.has('add'), true)
      assert.strictEqual(prefixes.has('pop'), true)
      assert.strictEqual(prefixes.size, 2)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('returns empty set when index is missing', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-snippet-missing-'))
    try {
      const prefixes = await loadSnippetPrefixSet(tmpDir)
      assert.strictEqual(prefixes.size, 0)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
