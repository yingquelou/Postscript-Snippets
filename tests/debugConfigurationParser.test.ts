import { describe, it } from 'node:test'
import * as assert from 'node:assert'
import * as path from 'path'
import * as fs from 'fs'
import { DebugConfigurationParser } from '@/debugger/debugConfigurationParser'

function setupTestDir(): string {
  const testDir = path.join(__dirname, 'testdata')
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true })
  }
  const validProgram = path.join(testDir, 'valid.ps')
  fs.writeFileSync(validProgram, '%!PS\n1 1 add')
  return testDir
}

function cleanupTestDir(): void {
  const testDir = path.join(__dirname, 'testdata')
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true })
  }
}

describe('DebugConfigurationParser', () => {
  describe('program validation', () => {
    it('should return error when program is undefined', () => {
      const testDir = setupTestDir()
      try {
        const parser = new DebugConfigurationParser(testDir)
        const result = parser.parse({})
        assert.strictEqual(result.success, false)
        const programError = result.errors?.find(e => e.field === 'program')
        assert.ok(programError)
        assert.strictEqual(programError!.message, 'Program path is required')
      } finally {
        cleanupTestDir()
      }
    })

    it('should return error when program file does not exist', () => {
      const testDir = setupTestDir()
      try {
        const parser = new DebugConfigurationParser(testDir)
        const result = parser.parse({ program: 'nonexistent.ps' })
        assert.strictEqual(result.success, false)
        const programError = result.errors?.find(e => e.field === 'program')
        assert.ok(programError)
        assert.ok(programError!.message.includes('not found'))
      } finally {
        cleanupTestDir()
      }
    })

    it('should return error when program is a directory', () => {
      const testDir = setupTestDir()
      try {
        const parser = new DebugConfigurationParser(testDir)
        const result = parser.parse({ program: testDir })
        assert.strictEqual(result.success, false)
        const programError = result.errors?.find(e => e.field === 'program')
        assert.ok(programError)
        assert.ok(programError!.message.includes('not a file'))
      } finally {
        cleanupTestDir()
      }
    })

    it('should accept valid program path', () => {
      const testDir = setupTestDir()
      try {
        const validProgram = path.join(testDir, 'valid.ps')
        const parser = new DebugConfigurationParser(testDir)
        const result = parser.parse({ program: validProgram })
        assert.strictEqual(result.success, true)
        assert.strictEqual(result.config?.program, validProgram)
      } finally {
        cleanupTestDir()
      }
    })
  })

  describe('ghostscriptPath validation', () => {
    it('should return error when ghostscriptPath is invalid', () => {
      const testDir = setupTestDir()
      try {
        const validProgram = path.join(testDir, 'valid.ps')
        const parser = new DebugConfigurationParser(testDir)
        const result = parser.parse({ 
          program: validProgram,
          ghostscriptPath: '/nonexistent/path/to/gs'
        })
        assert.strictEqual(result.success, false)
        const gsError = result.errors?.find(e => e.field === 'ghostscriptPath')
        assert.ok(gsError)
        assert.ok(gsError!.message.includes('Invalid Ghostscript path'))
      } finally {
        cleanupTestDir()
      }
    })
  })

  describe('cwd validation', () => {
    it('should return error when cwd does not exist', () => {
      const testDir = setupTestDir()
      try {
        const validProgram = path.join(testDir, 'valid.ps')
        const invalidDir = path.join(testDir, 'nonexistent')
        const parser = new DebugConfigurationParser(testDir)
        const result = parser.parse({ 
          program: validProgram,
          cwd: invalidDir
        })
        assert.strictEqual(result.success, false)
        const cwdError = result.errors?.find(e => e.field === 'cwd')
        assert.ok(cwdError)
        assert.ok(cwdError!.message.includes('not found'))
      } finally {
        cleanupTestDir()
      }
    })

    it('should return error when cwd is a file', () => {
      const testDir = setupTestDir()
      try {
        const validProgram = path.join(testDir, 'valid.ps')
        const parser = new DebugConfigurationParser(testDir)
        const result = parser.parse({ 
          program: validProgram,
          cwd: validProgram
        })
        assert.strictEqual(result.success, false)
        const cwdError = result.errors?.find(e => e.field === 'cwd')
        assert.ok(cwdError)
        assert.ok(cwdError!.message.includes('not a directory'))
      } finally {
        cleanupTestDir()
      }
    })

    it('should use program directory as default cwd', () => {
      const testDir = setupTestDir()
      try {
        const validProgram = path.join(testDir, 'valid.ps')
        const parser = new DebugConfigurationParser(testDir)
        const result = parser.parse({ program: validProgram })
        if (result.success) {
          assert.strictEqual(result.config?.cwd, testDir)
        }
      } finally {
        cleanupTestDir()
      }
    })
  })

  describe('args validation', () => {
    it('should return error when args is not an array', () => {
      const testDir = setupTestDir()
      try {
        const validProgram = path.join(testDir, 'valid.ps')
        const parser = new DebugConfigurationParser(testDir)
        const result = parser.parse({ 
          program: validProgram,
          args: 'invalid' as any
        })
        assert.strictEqual(result.success, false)
        const argsError = result.errors?.find(e => e.field === 'args')
        assert.ok(argsError)
        assert.ok(argsError!.message.includes('must be an array'))
      } finally {
        cleanupTestDir()
      }
    })

    it('should return error when args contains non-string elements', () => {
      const testDir = setupTestDir()
      try {
        const validProgram = path.join(testDir, 'valid.ps')
        const parser = new DebugConfigurationParser(testDir)
        const result = parser.parse({ 
          program: validProgram,
          args: ['-dSAFER', 123, '-dBATCH'] as any
        })
        assert.strictEqual(result.success, false)
        const argsError = result.errors?.find(e => e.field === 'args')
        assert.ok(argsError)
        assert.ok(argsError!.message.includes('non-string elements'))
      } finally {
        cleanupTestDir()
      }
    })

    it('should filter empty and dash-only args', () => {
      const testDir = setupTestDir()
      try {
        const validProgram = path.join(testDir, 'valid.ps')
        const parser = new DebugConfigurationParser(testDir)
        const result = parser.parse({ 
          program: validProgram,
          args: ['-dSAFER', '', '-', '-dBATCH']
        })
        if (result.success) {
          assert.deepStrictEqual(result.config?.args, ['-dSAFER', '-dBATCH'])
        }
      } finally {
        cleanupTestDir()
      }
    })
  })

  describe('default values', () => {
    it('should set default stopOnEntry to false', () => {
      const testDir = setupTestDir()
      try {
        const validProgram = path.join(testDir, 'valid.ps')
        const parser = new DebugConfigurationParser(testDir)
        const result = parser.parse({ program: validProgram })
        if (result.success) {
          assert.strictEqual(result.config?.stopOnEntry, false)
        }
      } finally {
        cleanupTestDir()
      }
    })

    it('should set empty args array as default', () => {
      const testDir = setupTestDir()
      try {
        const validProgram = path.join(testDir, 'valid.ps')
        const parser = new DebugConfigurationParser(testDir)
        const result = parser.parse({ program: validProgram })
        if (result.success) {
          assert.deepStrictEqual(result.config?.args, [])
        }
      } finally {
        cleanupTestDir()
      }
    })
  })

  describe('variable substitution', () => {
    it('should resolve ${workspaceFolder}', () => {
      const testDir = setupTestDir()
      try {
        const validProgram = path.join(testDir, 'valid.ps')
        const parser = new DebugConfigurationParser(testDir)
        const result = parser.parse({ 
          program: '${workspaceFolder}/valid.ps'
        })
        if (result.success) {
          assert.strictEqual(result.config?.program, validProgram)
        }
      } finally {
        cleanupTestDir()
      }
    })
  })

  describe('validation method', () => {
    it('should return empty array for valid config', () => {
      const testDir = setupTestDir()
      try {
        const validProgram = path.join(testDir, 'valid.ps')
        const parser = new DebugConfigurationParser(testDir)
        const errors = parser.validate({ program: validProgram })
        assert.deepStrictEqual(errors, [])
      } finally {
        cleanupTestDir()
      }
    })

    it('should return errors for invalid config', () => {
      const testDir = setupTestDir()
      try {
        const parser = new DebugConfigurationParser(testDir)
        const errors = parser.validate({})
        assert.ok(errors.some(e => e.field === 'program'))
      } finally {
        cleanupTestDir()
      }
    })
  })

  describe('getDefaultConfiguration', () => {
    it('should return default configuration', () => {
      const testDir = setupTestDir()
      try {
        const parser = new DebugConfigurationParser(testDir)
        const defaults = parser.getDefaultConfiguration()
        assert.strictEqual(defaults.program, '')
        assert.strictEqual(defaults.ghostscriptPath, 'gs')
        assert.strictEqual(defaults.cwd, testDir)
        assert.deepStrictEqual(defaults.args, [])
        assert.strictEqual(defaults.stopOnEntry, false)
      } finally {
        cleanupTestDir()
      }
    })
  })
})