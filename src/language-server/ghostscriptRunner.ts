import { execFile } from 'child_process'
import * as path from 'path'
import { DictionaryEntry } from './completionTypes'

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

      const rawName = line.slice(0, bracketStart)
      if (!rawName) continue
      if (!rawName.startsWith('{') || !rawName.endsWith('}')) continue

      const name = rawName.slice(1, -1)

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
    return this.getDictionaryStackWithDependencies([preloadFilePath], workingDirectory)
  }

  async getDictionaryStackWithDependencies(preloadFilePaths: string[], workingDirectory?: string): Promise<DictionaryEntry[]> {
    const resolvedPaths = preloadFilePaths.map(filePath => 
      path.isAbsolute(filePath) ? filePath : path.resolve(filePath)
    )
    const dictStackScript = path.join(this.psScriptsPath, 'dictionaryStack.ps')
    const allScripts = [...resolvedPaths, dictStackScript]
    const output = await this.runGhostscript(allScripts, workingDirectory)
    return parseDictionaryOutput(output)
  }

  private async runGhostscript(scriptPaths: string[], workingDirectory?: string): Promise<string> {
    let childProcess: ReturnType<typeof execFile> | undefined

    const cleanup = async (): Promise<void> => {
      if (childProcess && !childProcess.killed) {
        try {
          childProcess.kill('SIGTERM')
          await new Promise(resolve => setTimeout(resolve, 500))
          if (!childProcess.killed) {
            childProcess.kill('SIGKILL')
          }
        } catch {
          // Ignore kill errors
        }
      }
    }

    try {
      const execPromise = new Promise<string>((resolve, reject) => {
        childProcess = execFile(
          this.gsPath,
          [...GS_ARGS_PREFIX, ...this.currentBuildArgs, ...scriptPaths],
          { windowsHide: true, cwd: workingDirectory },
          (error, stdout, stderr) => {
            if (error) {
              const err = error as any
              err.stderr = stderr
              err.stdout = stdout
              reject(err)
            } else {
              resolve(stdout)
            }
          }
        )
      })

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          cleanup().catch(() => {})
          reject(new Error(`Ghostscript execution timed out after ${EXEC_TIMEOUT_MS}ms`))
        }, EXEC_TIMEOUT_MS)
      })

      const stdout = await Promise.race([execPromise, timeoutPromise])
      return stdout.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
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

      const message = [
        error instanceof Error ? error.message : String(error),
        ...details
      ]
        .filter(Boolean)
        .join('\n\n')

      console.error('[GhostscriptRunner] runGhostscript error:', message)
      throw new Error(message)
    } finally {
      await cleanup()
    }
  }
}
