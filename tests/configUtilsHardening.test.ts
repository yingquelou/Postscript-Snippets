import { describe, it } from 'node:test'
import * as assert from 'node:assert'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  resolveConfigPath,
  matchesCompileFile,
  findConfigPath,
  getProjectConfigForFile,
  validateProjectConfig
} from '../out/language-server/configUtils.js'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ps-cfg-'))
}

describe('resolveConfigPath single-base resolution', () => {
  it('resolves relative paths against configDir only', () => {
    const resolved = resolveConfigPath('deps/lib.ps', '/cfg/dir', '/some/other/file.ps', '/ws')
    assert.strictEqual(resolved.replace(/\\/g, '/'), '/cfg/dir/deps/lib.ps')
  })

  it('ignores currentFilePath as a resolution base (previous ambiguity)', () => {
    const a = resolveConfigPath('lib.ps', '/cfg', '/doc/nearby.ps', '/ws')
    const b = resolveConfigPath('lib.ps', '/cfg', '/elsewhere/x.ps', '/ws')
    assert.strictEqual(a, b)
  })

  it('keeps absolute paths untouched', () => {
    assert.strictEqual(resolveConfigPath('/abs/lib.ps', '/cfg'), '/abs/lib.ps')
  })

  it('falls back to workspaceRoot when no configDir', () => {
    const resolved = resolveConfigPath('lib.ps', undefined, undefined, '/ws')
    assert.strictEqual(resolved.replace(/\\/g, '/'), '/ws/lib.ps')
  })
})

describe('matchesCompileFile exact matching', () => {
  const root = tmpDir()
  const doc = path.join(root, 'src', 'main.ps')

  it('matches configDir-resolved exact path', () => {
    assert.strictEqual(matchesCompileFile(path.join('src', 'main.ps'), doc, root), true)
  })

  it('does NOT match on basename alone (silent mismatch removed)', () => {
    assert.strictEqual(matchesCompileFile(path.join('other', 'main.ps'), doc, root), false)
    assert.strictEqual(matchesCompileFile('main.ps', doc, root), false)
  })

  it('matches absolute config file paths', () => {
    assert.strictEqual(matchesCompileFile(doc, doc, root), true)
  })
})

describe('findConfigPath upward search', () => {
  it('finds a config in the file directory', async () => {
    const root = tmpDir()
    const sub = path.join(root, 'src')
    fs.mkdirSync(sub)
    fs.writeFileSync(path.join(sub, 'postscript.config.json'), '{}')
    const found = await findConfigPath(sub, root)
    assert.strictEqual(found, path.join(sub, 'postscript.config.json'))
  })

  it('walks up to stopDir inclusive', async () => {
    const root = tmpDir()
    const sub = path.join(root, 'src')
    fs.mkdirSync(sub)
    fs.writeFileSync(path.join(root, 'postscript.config.json'), '{}')
    const found = await findConfigPath(sub, root)
    assert.strictEqual(found, path.join(root, 'postscript.config.json'))
  })

  it('returns undefined when nothing exists up to stopDir', async () => {
    const root = tmpDir()
    const sub = path.join(root, 'a', 'b')
    fs.mkdirSync(sub, { recursive: true })
    const found = await findConfigPath(sub, root)
    assert.strictEqual(found, undefined)
  })
})

describe('getProjectConfigForFile', () => {
  it('prefers the nearest config over the workspace root', async () => {
    const root = tmpDir()
    const sub = path.join(root, 'proj')
    fs.mkdirSync(sub)
    fs.writeFileSync(path.join(root, 'postscript.config.json'),
      JSON.stringify({ globalDependencies: ['root.ps'] }))
    fs.writeFileSync(path.join(sub, 'postscript.config.json'),
      JSON.stringify({ globalDependencies: ['near.ps'] }))

    const doc = path.join(sub, 'main.ps')
    fs.writeFileSync(doc, '')

    const result = await getProjectConfigForFile(doc, root)
    assert.strictEqual(result.configDir, sub)
    assert.strictEqual(result.rawConfig.globalDependencies?.[0], 'near.ps')
  })

  it('falls back to the workspace root config', async () => {
    const root = tmpDir()
    const sub = path.join(root, 'src')
    fs.mkdirSync(sub)
    fs.writeFileSync(path.join(root, 'postscript.config.json'),
      JSON.stringify({ globalDependencies: ['root.ps'] }))
    const doc = path.join(sub, 'main.ps')
    fs.writeFileSync(doc, '')

    const result = await getProjectConfigForFile(doc, root)
    assert.strictEqual(result.configDir, root)
    assert.strictEqual(result.rawConfig.globalDependencies?.[0], 'root.ps')
  })

  it('returns empty config when none exists anywhere', async () => {
    const root = tmpDir()
    const doc = path.join(root, 'main.ps')
    fs.writeFileSync(doc, '')
    const result = await getProjectConfigForFile(doc, root)
    assert.deepStrictEqual(result.rawConfig, {})
    assert.strictEqual(result.configPath, undefined)
  })
})

describe('validateProjectConfig semantic issues', () => {
  it('flags missing referenced files as errors', async () => {
    const dir = tmpDir()
    const issues = await validateProjectConfig({
      dependencies: [{ file: 'main.ps', inputs: ['missing-dep.ps'] }],
      workspaceDependencies: ['missing-ws.ps'],
      globalDependencies: ['missing-global.ps']
    }, dir)
    const messages = issues.map(i => i.message).join('\n')
    assert.ok(issues.some(i => i.level === 'error' && i.message.includes('missing-dep.ps')), messages)
    assert.ok(issues.some(i => i.level === 'error' && i.message.includes('missing-ws.ps')), messages)
    assert.ok(issues.some(i => i.level === 'error' && i.message.includes('missing-global.ps')), messages)
  })

  it('flags duplicate target declarations once', async () => {
    const dir = tmpDir()
    const main = path.join(dir, 'main.ps')
    fs.writeFileSync(main, '')
    const issues = await validateProjectConfig({
      dependencies: [
        { file: 'main.ps', inputs: [] },
        { file: 'main.ps', inputs: [] }
      ]
    }, dir)
    const dupWarnings = issues.filter(i => i.level === 'warning' && i.message.includes('more than once'))
    assert.strictEqual(dupWarnings.length, 1)
  })

  it('flags a target listing itself in its own inputs', async () => {
    const dir = tmpDir()
    const main = path.join(dir, 'main.ps')
    fs.writeFileSync(main, '')
    const issues = await validateProjectConfig({
      dependencies: [{ file: 'main.ps', inputs: ['main.ps'] }]
    }, dir)
    assert.ok(issues.some(i => i.level === 'warning' && i.message.includes('lists itself')))
  })

  it('flags structural type errors', async () => {
    const dir = tmpDir()
    const issues = await validateProjectConfig({
      dependencies: 'not-an-array',
      workspaceDependencies: 'nope'
    } as any, dir)
    assert.ok(issues.some(i => i.level === 'error' && i.message.includes('"dependencies" must be an array')))
    assert.ok(issues.some(i => i.level === 'error' && i.message.includes('"workspaceDependencies" must be an array')))
  })

  it('flags cross-level duplicate loads', async () => {
    const dir = tmpDir()
    fs.writeFileSync(path.join(dir, 'shared.ps'), '')
    const issues = await validateProjectConfig({
      workspaceDependencies: ['shared.ps'],
      globalDependencies: ['shared.ps']
    }, dir)
    assert.ok(issues.some(i => i.level === 'warning' && i.message.includes('loaded twice')))
  })

  it('reports nothing for a clean config', async () => {
    const dir = tmpDir()
    fs.writeFileSync(path.join(dir, 'main.ps'), '')
    fs.writeFileSync(path.join(dir, 'lib.ps'), '')
    const issues = await validateProjectConfig({
      dependencies: [{ file: 'main.ps', inputs: ['lib.ps'] }]
    }, dir)
    assert.deepStrictEqual(issues, [])
  })
})
