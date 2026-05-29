import { describe, it } from 'node:test'
import * as assert from 'node:assert'
import { parseDictionaryOutput } from '../out/language-server/ghostscriptRunner.js'
import { getCompletionPrefix, matchesDictionaryEntry, completionSortText } from '../out/language-server/completionUtils.js'

describe('parseDictionaryOutput', () => {
  it('parses {name}[typename] lines and strips type suffix', () => {
    const output = '{show}[operatortype]\n{myVar}[packedarraytype]\n'
    const entries = parseDictionaryOutput(output)
    assert.strictEqual(entries.length, 2)
    assert.deepStrictEqual(entries[0], { name: 'show', type: 'operator' })
    assert.deepStrictEqual(entries[1], { name: 'myVar', type: 'packedarray' })
  })

  it('falls back to any for unknown types', () => {
    const entries = parseDictionaryOutput('{foo}[weirdtype]\n')
    assert.strictEqual(entries[0].type, 'any')
  })

  it('skips malformed lines', () => {
    const entries = parseDictionaryOutput('[onlybracket]\n{valid}[operatortype]\n')
    assert.strictEqual(entries.length, 1)
    assert.strictEqual(entries[0].name, 'valid')
  })

  it('skips lines without braces', () => {
    const entries = parseDictionaryOutput('show[operatortype]\n{valid}[operatortype]\n')
    assert.strictEqual(entries.length, 1)
    assert.strictEqual(entries[0].name, 'valid')
  })
})

describe('completionUtils', () => {
  it('extracts prefix including leading slash', () => {
    assert.strictEqual(getCompletionPrefix('/show ', 5), 'show')
    assert.strictEqual(getCompletionPrefix('  add', 5), 'add')
  })

  it('matches entries with or without leading slash in name', () => {
    const entry = { name: 'show', type: 'operator' as const }
    assert.strictEqual(matchesDictionaryEntry(entry, 'sh'), true)
    assert.strictEqual(matchesDictionaryEntry(entry, 'xy'), false)
    const literal = { name: '/show', type: 'name' as const }
    assert.strictEqual(matchesDictionaryEntry(literal, 'sh'), true)
  })

  it('matches entries when the typed text appears inside the name', () => {
    const entry = { name: 'showpage', type: 'operator' as const }
    assert.strictEqual(matchesDictionaryEntry(entry, 'owp'), true)
    const literal = { name: '/showpage', type: 'operator' as const }
    assert.strictEqual(matchesDictionaryEntry(literal, 'owp'), true)
    assert.strictEqual(matchesDictionaryEntry(entry, 'xyz'), false)
  })

  it('matches entries by subsequence letters', () => {
    const entry = { name: 'showpage', type: 'operator' as const }
    assert.strictEqual(matchesDictionaryEntry(entry, 'sp'), true)
    assert.strictEqual(matchesDictionaryEntry(entry, 'sg'), true)
    assert.strictEqual(matchesDictionaryEntry(entry, 'sge'), true)
    assert.strictEqual(matchesDictionaryEntry(entry, 'hpz'), false)
  })

  it('sorts prefix matches before substring matches before subsequence matches', () => {
    const prefix = completionSortText({ name: 'show', type: 'operator' }, 'sh')
    const substring = completionSortText({ name: 'myshow', type: 'operator' }, 'sh')
    const subsequence = completionSortText({ name: 'showpage', type: 'operator' }, 'sp')

    assert.ok(prefix < substring)
    assert.ok(substring < subsequence)
  })

  it('sorts exact match highest', () => {
    const exact = completionSortText({ name: 'show', type: 'operator' }, 'show')
    const prefix = completionSortText({ name: 'showpage', type: 'operator' }, 'sh')
    assert.ok(exact < prefix)
  })

  it('prefers shorter matches when match type is equal', () => {
    const shortEntry = completionSortText({ name: 'show', type: 'operator' }, 's')
    const longEntry = completionSortText({ name: 'showpage', type: 'operator' }, 's')
    assert.ok(shortEntry < longEntry)
  })

  it('prefers operator entries over non-operator entries when other factors are equal', () => {
    const operatorEntry = completionSortText({ name: 'sham', type: 'operator' }, 'sh')
    const nameEntry = completionSortText({ name: 'sham', type: 'name' }, 'sh')
    assert.ok(operatorEntry < nameEntry)
  })
})
