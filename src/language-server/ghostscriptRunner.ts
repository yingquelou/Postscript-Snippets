import { execFile } from 'child_process'
import { promisify } from 'util'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { DictionaryEntry } from './completionTypes'

const execFileAsync = promisify(execFile)
const readFileAsync = promisify(fs.readFile)
const unlinkAsync = promisify(fs.unlink)

const GS_ARGS_PREFIX = ['-dNOPAUSE', '-dNOPROMPT', '-dBATCH', '-dQUIET', '-sDEVICE=nullpage'] as const
const EXEC_TIMEOUT_MS = 30000

export function parseDictionaryOutput(output: string): DictionaryEntry[] {
  const entries: DictionaryEntry[] = []
  const length = output.length
  let lineStart = 0

  for (let i = 0; i <= length; i++) {
    if (i === length || output[i] === '\n') {
      const lineEnd = i
      if (lineStart >= lineEnd) {
        lineStart = i + 1
        continue
      }

      const line = output.slice(lineStart, lineEnd)
      lineStart = i + 1

      const bracketStart = line.lastIndexOf('[')
      if (bracketStart < 0) continue

      const bracketEnd = line.lastIndexOf(']')
      if (bracketEnd <= bracketStart) continue

      const name = line.slice(0, bracketStart).trim()
      if (!name) continue

      const typeStr = line.slice(bracketStart + 1, bracketEnd).trim()
      if (!typeStr) continue

      let type = typeStr.toLowerCase()
      if (type.endsWith('type')) {
        type = type.slice(0, -4)
      }
      const normalizedType = isValidDictionaryType(type) ? type : 'any'
      entries.push({ name, type: normalizedType as DictionaryEntry['type'] })
    }
  }

  return entries
}

function isValidDictionaryType(type: string): type is DictionaryEntry['type'] {
  const validTypes: DictionaryEntry['type'][] = [
    'array', 'boolean', 'dict', 'file', 'fontID', 'gstate',
    'integer', 'mark', 'name', 'null', 'operator', 'packedarray',
    'real', 'save', 'string', 'any'
  ]
  return validTypes.includes(type as DictionaryEntry['type'])
}

export class GhostscriptRunner {
  private gsPath: string
  private psScriptsPath: string
  private currentBuildArgs: string[] = []

  constructor(gsPath: string = 'gs', psScriptsPath?: string) {
    this.gsPath = gsPath
    this.psScriptsPath = psScriptsPath || ''
  }

  setGsPath(gsPath: string): void {
    this.gsPath = gsPath
  }

  setBuildArgs(buildArgs: string[]): void {
    this.currentBuildArgs = buildArgs
  }

  async executePsFile(filePath: string, workingDirectory?: string): Promise<string> {
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.psScriptsPath, filePath)
    return this.runGhostscript([fullPath], workingDirectory)
  }

  async getDictionaryStack(workingDirectory?: string): Promise<DictionaryEntry[]> {
    const output = await this.executePsFile('dictionaryStack.ps', workingDirectory)
    return parseDictionaryOutput(output)
  }

  async getDictionaryStackAfterPreload(preloadFilePath: string, workingDirectory?: string): Promise<DictionaryEntry[]> {
    const preloadFull = path.isAbsolute(preloadFilePath)
      ? preloadFilePath
      : path.resolve(preloadFilePath)
    const dictStackScript = path.join(this.psScriptsPath, 'dictionaryStack.ps')
    const output = await this.runGhostscript([preloadFull, dictStackScript], workingDirectory)
    return parseDictionaryOutput(output)
  }

  private async runGhostscript(scriptPaths: string[], workingDirectory?: string): Promise<string> {
    const outputFile = path.join(os.tmpdir(), `gs_output_${Date.now()}_${process.pid}.txt`)

    try {
      await execFileAsync(
        this.gsPath,
        [...GS_ARGS_PREFIX, ...this.currentBuildArgs, `-sstdout=${outputFile}`, ...scriptPaths],
        { timeout: EXEC_TIMEOUT_MS, windowsHide: true, cwd: workingDirectory }
      )
      const buffer = await readFileAsync(outputFile)
      return buffer.toString('utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    } catch (error: unknown) {
      const details: string[] = []
      if (error && typeof error === 'object') {
        const stderr = (error as any).stderr
        const stdout = (error as any).stdout
        if (typeof stderr === 'string' && stderr.trim()) {
          details.push(`stderr:\n${stderr.trim()}`)
        }
        if (typeof stdout === 'string' && stdout.trim()) {
          details.push(`stdout:\n${stdout.trim()}`)
        }
      }

      try {
        const fileBuffer = await readFileAsync(outputFile)
        const fileText = fileBuffer.toString('utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
        if (fileText) {
          details.push(`ghostscript output:\n${fileText}`)
        }
      } catch {
        // ignore missing output file
      }

      const message = [
        error instanceof Error ? error.message : String(error),
        ...details
      ]
        .filter(Boolean)
        .join('\n\n')

      console.error('[GhostscriptRunner] runGhostscript error:', message)
      throw new Error(message)
    } finally {
      try {
        await unlinkAsync(outputFile)
      } catch (cleanupError) {
        console.warn('[GhostscriptRunner] Failed to clean up temp file:', outputFile, cleanupError)
      }
    }
  }
}
