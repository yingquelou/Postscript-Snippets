import { describe, it } from 'node:test'
import * as assert from 'node:assert'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { DictionaryStackManager } from '../out/language-server/dictionaryStackManager.js'
import { GhostscriptRunner } from '../out/language-server/ghostscriptRunner.js'

describe('DictionaryStackManager preload caching', () => {
  const createTempFile = async (dir: string, name: string, content: string) => {
    const filePath = path.join(dir, name)
    await fs.writeFile(filePath, content, 'utf-8')
    return filePath
  }

  it('reloads only changed level when file-level paths change', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ps-preload-'))
    try {
      const filePath1 = await createTempFile(tempDir, 'file1.ps', 'file1 operator\n')
      const filePath2 = await createTempFile(tempDir, 'file2.ps', 'file2 operator\n')
      const workspacePath = await createTempFile(tempDir, 'workspace.ps', 'workspaceOp operator\n')
      const globalPath = await createTempFile(tempDir, 'global.ps', 'globalOp operator\n')

      const manager = new DictionaryStackManager()
      const originalExtract = (manager as any).extractEntriesFromFile.bind(manager)
      let extractCount = 0
      ;(manager as any).extractEntriesFromFile = async (filePath: string) => {
        extractCount++
        return originalExtract(filePath)
      }

      await manager.loadPreloadedEntries({
        fileLevel: [filePath1],
        workspaceLevel: [workspacePath],
        globalLevel: [globalPath]
      })

      assert.strictEqual(extractCount, 3)
      extractCount = 0

      await manager.loadPreloadedEntries({
        fileLevel: [filePath2],
        workspaceLevel: [workspacePath],
        globalLevel: [globalPath]
      })

      assert.strictEqual(extractCount, 1)
      const stack = manager.getDictionaryStackInfo()
      assert.ok(stack.entries.some(entry => entry.name === 'file2'))
      assert.ok(stack.entries.some(entry => entry.name === 'workspaceOp'))
      assert.ok(stack.entries.some(entry => entry.name === 'globalOp'))
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  it('refreshes workspace-level entries when workspace preload file changes', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ps-preload-'))
    try {
      const workspacePath = await createTempFile(tempDir, 'workspace.ps', 'workspaceOp operator\n')
      const manager = new DictionaryStackManager()

      await manager.loadPreloadedEntries({
        fileLevel: [],
        workspaceLevel: [workspacePath],
        globalLevel: []
      })

      let stack = manager.getDictionaryStackInfo()
      assert.ok(stack.entries.some(entry => entry.name === 'workspaceOp'))

      await fs.writeFile(workspacePath, 'workspaceUpdated operator\n', 'utf-8')
      await manager.loadPreloadedEntries({
        fileLevel: [],
        workspaceLevel: [workspacePath],
        globalLevel: []
      })

      stack = manager.getDictionaryStackInfo()
      assert.ok(stack.entries.some(entry => entry.name === 'workspaceUpdated'))
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  it('preserves preload errors when paths and cache are unchanged', async () => {
    const manager = new DictionaryStackManager()
    let extractAttempts = 0
    ;(manager as any).extractEntriesFromFile = async (filePath: string) => {
      extractAttempts++
      throw new Error('Simulated preload failure')
    }

    await manager.loadPreloadedEntries({
      fileLevel: ['missing.ps'],
      workspaceLevel: [],
      globalLevel: []
    })

    const firstErrors = manager.getPreloadErrors()
    assert.strictEqual(firstErrors.length, 1)
    assert.strictEqual(firstErrors[0].message, 'Simulated preload failure')

    ;(manager as any).shouldReloadLevel = async () => false

    await manager.loadPreloadedEntries({
      fileLevel: ['missing.ps'],
      workspaceLevel: [],
      globalLevel: []
    })

    const secondErrors = manager.getPreloadErrors()
    assert.strictEqual(secondErrors.length, 1)
    assert.strictEqual(secondErrors[0].message, 'Simulated preload failure')
    assert.strictEqual(extractAttempts, 1)
  })

  it('captures Ghostscript errors as preload diagnostics for PS files', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ps-preload-'))
    try {
      const psPath = await createTempFile(tempDir, 'bad.ps', '/g true def\nundefined gg\n')
      const manager = new DictionaryStackManager()
      ;(manager as any).gsRunner.getDictionaryStackAfterPreload = async () => {
        throw new Error('Ghostscript execution failed')
      }

      await manager.loadPreloadedEntries({
        fileLevel: [psPath],
        workspaceLevel: [],
        globalLevel: []
      })

      const errors = manager.getPreloadErrors()
      assert.strictEqual(errors.length, 1)
      assert.strictEqual(errors[0].errorType, 'ghostscript-error')
      assert.strictEqual(errors[0].message, 'Ghostscript execution failed')
      assert.strictEqual(errors[0].filePath, psPath)
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

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
