import * as fs from 'fs'
import * as path from 'path'

export interface CacheKeyComponents {
  filePath: string
  globalLevel: string[]
  workspaceLevel: string[]
  fileLevel: string[]
}

export interface CacheEntry {
  entries: DictionaryEntry[]
  timestamp: number
  dependenciesMtime: number
}

export interface DictionaryEntry {
  name: string
  type: 'array' | 'boolean' | 'dict' | 'file' | 'fontID' | 'gstate' | 'integer' | 'mark' | 'name' | 'null' | 'operator' | 'packedarray' | 'real' | 'save' | 'string' | 'any'
}

export async function generateCacheKey(components: CacheKeyComponents): Promise<string> {
  const { filePath, globalLevel, workspaceLevel, fileLevel } = components
  
  const allFiles = [...globalLevel, ...workspaceLevel, ...fileLevel]
  const filesKey = allFiles.join('|')
  
  let combinedMtime = 0
  for (const file of allFiles) {
    try {
      const stats = await fs.promises.stat(file)
      combinedMtime += stats.mtime.getTime()
    } catch {
      combinedMtime += Date.now()
    }
  }
  
  const normalizedPath = path.normalize(filePath).replace(/\\/g, '/')
  return `${normalizedPath}|${filesKey}|${combinedMtime}`
}

export function generateCacheKeyFromPreloadConfig(
  filePath: string,
  globalLevel: string[],
  workspaceLevel: string[],
  fileLevel: string[]
): string {
  const allFiles = [...globalLevel, ...workspaceLevel, ...fileLevel]
  const filesKey = allFiles.join('|')
  const normalizedPath = path.normalize(filePath).replace(/\\/g, '/')
  
  return `${normalizedPath}|${filesKey}`
}

export async function getDependenciesMtime(files: string[]): Promise<number> {
  let mtime = 0
  for (const file of files) {
    try {
      const stats = await fs.promises.stat(file)
      mtime += stats.mtime.getTime()
    } catch {
      mtime += Date.now()
    }
  }
  return mtime
}