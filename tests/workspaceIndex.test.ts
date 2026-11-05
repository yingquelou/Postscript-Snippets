import { describe, it } from 'node:test'
import * as assert from 'node:assert'
import { extractDefinitions, WorkspaceIndex, DefEntry } from '../out/language-server/workspaceIndex.js'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'

function findDef(defs: DefEntry[], name: string): DefEntry | undefined {
  return defs.find(d => d.name === name)
}

describe('extractDefinitions', () => {
  it('extracts simple /name value def', () => {
    const text = '/a 1 def'
    const defs = extractDefinitions(text)
    assert.strictEqual(defs.length, 1)
    assert.strictEqual(defs[0].name, 'a')
    assert.strictEqual(defs[0].isProcedure, false)
    // selection range points at the literal-name token `/a`
    assert.strictEqual(text.slice(defs[0].startOffset, defs[0].endOffset), '/a')
    assert.strictEqual(defs[0].startLine, 1)
    assert.strictEqual(defs[0].startColumn, 1)
  })

  it('marks procedure definitions', () => {
    const defs = extractDefinitions('/draw { moveto lineto stroke } bind def')
    const d = findDef(defs, 'draw')
    assert.ok(d)
    assert.strictEqual(d!.isProcedure, true)
  })

  it('does not record names inside array constructors as def keys', () => {
    const defs = extractDefinitions('[ /x 2 ] def')
    assert.deepStrictEqual(defs, [])
  })

  it('records names before and after procedure bodies at top level', () => {
    const text = '/a { 1 } def /b 2 def'
    const defs = extractDefinitions(text)
    assert.deepStrictEqual(defs.map(d => d.name).sort(), ['a', 'b'])
    assert.strictEqual(findDef(defs, 'b')!.isProcedure, false)
  })

  it('handles nested procedures and depth tracking', () => {
    const text = '/outer { /inner { 1 } def } def'
    const defs = extractDefinitions(text)
    const names = defs.map(d => d.name).sort()
    assert.deepStrictEqual(names, ['inner', 'outer'])
    const inner = findDef(defs, 'inner')!
    // inner's def is nested inside outer's procedure body
    assert.ok(inner.startOffset > 0)
  })

  it('multiline files report correct line numbers', () => {
    const text = '% comment\n/a 1 def\n% more\n/b { } def\n'
    const defs = extractDefinitions(text)
    assert.strictEqual(findDef(defs, 'a')!.startLine, 2)
    assert.strictEqual(findDef(defs, 'b')!.startLine, 4)
  })

  it('mark does not consume the pending key (lexical pairing preserved)', () => {
    // runtime-valid: /a survives cleartomark on the stack, then a = 2
    const defs = extractDefinitions('/a mark 1 cleartomark 2 def')
    assert.deepStrictEqual(defs.map(d => d.name), ['a'])
  })

  it('binary-ish content does not throw', () => {
    const text = '/a \u0000\u0001\u0002 def'
    assert.doesNotThrow(() => extractDefinitions(text))
  })
})

describe('WorkspaceIndex', () => {
  function makeFakeIo(files: Record<string, string>, root: string) {
    return {
      stat: async (p: string) => ({ mtimeMs: 1000, size: files[p]?.length ?? 0 }),
      readFile: async (p: string) => files[p] ?? '',
      walk: async () => Object.keys(files)
    }
  }

  it('indexes files across the workspace and answers lookup/query', async () => {
    const root = path.join(os.tmpdir(), 'ps-idx-test')
    const files: Record<string, string> = {
      [path.join(root, 'a.ps')]: '/draw { } def',
      [path.join(root, 'sub', 'b.ps')]: '/draw { } def /color 1 def'
    }
    const io = makeFakeIo(files, root)
    const index = new WorkspaceIndex(root, io as any)
    await index.ensure()

    const hits = index.lookup('draw')
    assert.strictEqual(hits.length, 2)
    assert.ok(hits.every(h => h.def.isProcedure))

    const q = index.query('col')
    assert.strictEqual(q.length, 1)
    assert.strictEqual(q[0].def.name, 'color')

    // empty query returns everything
    assert.strictEqual(index.query('').length, 3)
  })

  it('upsertFile is mtime-aware and dropFile removes entries', async () => {
    const root = path.join(os.tmpdir(), 'ps-idx-test2')
    const p = path.join(root, 'x.ps')
    let content = '/a 1 def'
    let mtime = 1000
    const io = {
      stat: async () => ({ mtimeMs: mtime, size: content.length }),
      readFile: async () => content,
      walk: async () => [p]
    }
    const index = new WorkspaceIndex(root, io as any)
    await index.ensure()
    assert.strictEqual(index.lookup('a').length, 1)

    // same mtime → cached, no change even though content changed
    content = '/b 2 def'
    await index.upsertFile(p)
    assert.strictEqual(index.lookup('a').length, 1)
    assert.strictEqual(index.lookup('b').length, 0)

    // new mtime → re-indexed
    mtime = 2000
    await index.upsertFile(p)
    assert.strictEqual(index.lookup('a').length, 0)
    assert.strictEqual(index.lookup('b').length, 1)

    index.dropFile(p)
    assert.strictEqual(index.all().length, 0)
  })

  it('walks a real tmpdir workspace with skip dirs', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-idx-real-'))
    fs.mkdirSync(path.join(root, 'sub'), { recursive: true })
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true })
    fs.writeFileSync(path.join(root, 'main.ps'), '/entry { } def')
    fs.writeFileSync(path.join(root, 'sub', 'lib.ps'), '/helper 1 def')
    fs.writeFileSync(path.join(root, 'node_modules', 'junk.ps'), '/evil 1 def')
    fs.writeFileSync(path.join(root, 'notes.txt'), '/ignored 1 def')

    const index = new WorkspaceIndex(root)
    await index.ensure()
    const names = index.all().map(e => e.def.name).sort()
    assert.deepStrictEqual(names, ['entry', 'helper'])
    // uri is a proper file:// URL
    const entry = index.lookup('entry')[0]
    assert.ok(entry.uri.startsWith('file://'))
  })
})
