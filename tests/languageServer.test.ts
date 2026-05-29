import { describe, it } from 'node:test'
import * as assert from 'node:assert'
import { parseFileLevelPreloadConfig, resolveFileLevelPreloadPaths } from '../out/language-server/configUtils.js'

const workspaceRoot = process.platform === 'win32' ? 'C:/repo/project' : '/repo/project'
const filePath = process.platform === 'win32' ? 'C:/repo/project/src/foo.ps' : '/repo/project/src/foo.ps'

describe('languageServer dependency configuration', () => {
  it('parses a manifest array of file/input objects', () => {
    const mapping = parseFileLevelPreloadConfig([
      { file: 'src/foo.ps', inputs: ['defs.ps'] },
      { file: 'other.ps', inputs: ['lib.ps', 'util.ps'] }
    ])

    assert.deepStrictEqual(mapping, {
      'src/foo.ps': { inputs: ['defs.ps'], executable: undefined, workingDirectory: undefined, buildArgs: undefined },
      'other.ps': { inputs: ['lib.ps', 'util.ps'], executable: undefined, workingDirectory: undefined, buildArgs: undefined }
    })
  })

  it('parses executable and workingDirectory fields', () => {
    const mapping = parseFileLevelPreloadConfig([
      { file: 'src/foo.ps', inputs: ['defs.ps'], executable: 'custom-gs.exe', workingDirectory: './lib', buildArgs: ['-dSAFER'] }
    ])

    assert.deepStrictEqual(mapping, {
      'src/foo.ps': { inputs: ['defs.ps'], executable: 'custom-gs.exe', workingDirectory: './lib', buildArgs: ['-dSAFER'] }
    })
  })

  it('resolves file-specific preload paths by workspace-relative key then basename fallback', () => {
    const rawValue = [
      { file: 'src/foo.ps', inputs: ['src-file.ps'] },
      { file: 'foo.ps', inputs: ['basename-file.ps'] }
    ]

    assert.deepStrictEqual(
      resolveFileLevelPreloadPaths(rawValue, filePath, workspaceRoot),
      { inputs: ['src-file.ps'], executable: undefined, workingDirectory: undefined, buildArgs: undefined }
    )
  })

  it('falls back to basename when workspace-relative key is absent', () => {
    const rawValue = [
      { file: 'foo.ps', inputs: ['basename-file.ps'] }
    ]

    assert.deepStrictEqual(
      resolveFileLevelPreloadPaths(rawValue, filePath, workspaceRoot),
      { inputs: ['basename-file.ps'], executable: undefined, workingDirectory: undefined, buildArgs: undefined }
    )
  })

  it('returns empty config when no current file is provided', () => {
    const value: Array<{ file?: string; inputs?: string[] }> = []
    assert.deepStrictEqual(resolveFileLevelPreloadPaths(value, undefined, undefined), { inputs: [] })
  })

  it('returns empty mapping for non-array input', () => {
    const mapping = parseFileLevelPreloadConfig('invalid' as any)
    assert.deepStrictEqual(mapping, {})
  })

  it('ignores entries without file field', () => {
    const mapping = parseFileLevelPreloadConfig([
      { inputs: ['defs.ps'] },
      { file: 'valid.ps', inputs: ['lib.ps'] }
    ])

    assert.deepStrictEqual(mapping, {
      'valid.ps': { inputs: ['lib.ps'], executable: undefined, workingDirectory: undefined, buildArgs: undefined }
    })
  })
})
