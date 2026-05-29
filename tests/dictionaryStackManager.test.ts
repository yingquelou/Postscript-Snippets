import { describe, it } from 'node:test'
import * as assert from 'node:assert'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { DictionaryStackManager } from '../out/language-server/dictionaryStackManager.js'
import { GhostscriptRunner } from '../out/language-server/ghostscriptRunner.js'

describe('DictionaryStackManager preload caching', () => {
  it('loads system entries on initialization', async () => {
    const manager = new DictionaryStackManager()
    await manager.loadSystemEntries()

    const info = await manager.getDictionaryStackInfo({
      fileLevel: [],
      workspaceLevel: [],
      globalLevel: []
    })
    assert.ok(info.entries.length > 0, 'System entries should be loaded')
    assert.ok(info.entries.some((entry: any) => entry.name === 'show'), 'Should have standard PostScript operators')
  })

  it('returns system entries with empty preload config', async () => {
    const manager = new DictionaryStackManager()
    await manager.loadSystemEntries()

    const info = await manager.getDictionaryStackInfo({
      fileLevel: [],
      workspaceLevel: [],
      globalLevel: []
    })

    assert.ok(info.entries.length > 0, 'Should return system entries even with empty preload config')
  })
})

describe('GhostscriptRunner error handling', () => {
  it('includes stderr output in GhostscriptRunner failure messages', async () => {
    const runner = new GhostscriptRunner('node')
    let thrown = null
    try {
      await runner['getDictionaryStackAfterPreload']('dummy.ps')
    } catch (error) {
      thrown = error
    }

    assert.ok(thrown instanceof Error)
    assert.ok(/stderr:/i.test(thrown.message) || /stdout:/i.test(thrown.message), 'Expected stderr or stdout details in error message')
  })
})
