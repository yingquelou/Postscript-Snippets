import { DictionaryEntry, DictionaryStackInfo, PreloadConfig } from './completionTypes'
import { GhostscriptRunner } from './ghostscriptRunner'
import { resolveGsExecutable } from '../ghostscriptHelper'
import { resolveRealPath, djb2Hash } from './cacheUtils'

import * as fs from 'fs'
import * as path from 'path'

export interface PreloadError {
  filePath: string
  level: 'global' | 'workspace' | 'file'
  message: string
  errorType: 'file-not-found' | 'parse-error' | 'ghostscript-error' | 'unknown'
}

interface PerFileCacheEntry {
  entries: DictionaryEntry[]
  timestamp: number
  dependenciesMtime: number
}

const MAX_PER_FILE_CACHE_SIZE = 100

class LRUCache<K, V> {
  private cache: Map<K, V> = new Map()
  private maxSize: number

  constructor(maxSize: number) {
    this.maxSize = maxSize
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key)
    if (value !== undefined) {
      this.cache.delete(key)
      this.cache.set(key, value)
    }
    return value
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key)
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
      }
    }
    this.cache.set(key, value)
  }

  has(key: K): boolean {
    return this.cache.has(key)
  }

  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }
}

export class DictionaryStackManager {
  private systemEntries: DictionaryEntry[] = []
  private gsRunner: GhostscriptRunner
  private systemLoaded: boolean = false
  private currentExecutable: string = ''
  private currentWorkingDirectory: string = ''
  private currentBuildArgs: string[] = []
  private preloadErrors: PreloadError[] = []
  
  private perFileCache: LRUCache<string, PerFileCacheEntry> = new LRUCache(MAX_PER_FILE_CACHE_SIZE)
  
  private systemLoadPromise: Promise<void> | undefined

  constructor(psScriptsPath?: string, gsPath?: string) {
    const resolvedPsScriptsPath = psScriptsPath || path.join(process.cwd(), 'ps')
    const resolvedGsPath = resolveGsExecutable(gsPath)
    this.gsRunner = new GhostscriptRunner(resolvedGsPath, resolvedPsScriptsPath)
    this.currentExecutable = resolvedGsPath
  }

  getPreloadErrors(): PreloadError[] {
    return [...this.preloadErrors]
  }

  clearPreloadErrors(): void {
    this.preloadErrors = []
  }

  async loadSystemEntries(force: boolean = false): Promise<void> {
    if (!force && this.systemLoaded) {
      return
    }
    
    if (this.systemLoadPromise) {
      await this.systemLoadPromise
      return
    }
    
    this.systemLoadPromise = this._loadSystemEntriesInternal(force)
    try {
      await this.systemLoadPromise
    } finally {
      this.systemLoadPromise = undefined
    }
  }

  private async _loadSystemEntriesInternal(force: boolean): Promise<void> {
    if (!force && this.systemLoaded) {
      return
    }
    
    try {
      this.systemEntries = await this.gsRunner.getDictionaryStack(this.currentWorkingDirectory || undefined)
      this.systemLoaded = true
    } catch (error) {
      this.systemEntries = []
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.preloadErrors.push({
        filePath: 'system',
        level: 'global',
        message: `Failed to load system dictionary entries: ${errorMessage}`,
        errorType: 'ghostscript-error'
      })
    }
  }

  async loadPreloadedEntries(config: PreloadConfig, currentFilePath?: string): Promise<void> {
    if (!currentFilePath) {
      return
    }

    const allDependencies = [
      ...config.globalLevel,
      ...config.workspaceLevel,
      ...config.fileLevel
    ]

    const needsSystemReload = this.updateConfiguration(config)

    if (needsSystemReload) {
      await this.loadSystemEntries(true)
    }

    const cacheKey = await this.generateCacheKey(config)
    const cached = this.perFileCache.get(cacheKey)
    
    if (!needsSystemReload && cached) {
      const currentMtime = await this.computeDependenciesMtime(allDependencies)
      if (currentMtime === cached.dependenciesMtime) {
        return
      }
    }

    this.preloadErrors = []

    let entries: DictionaryEntry[] = []
    
    try {
      if (allDependencies.length > 0) {
        entries = await this.gsRunner.getDictionaryStackWithDependencies(
          allDependencies,
          this.currentWorkingDirectory || undefined
        )
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.preloadErrors.push({
        filePath: allDependencies.join(', '),
        level: 'file',
        message: errorMessage,
        errorType: this.determineErrorType(error)
      })
    }

    const dependenciesMtime = await this.getDependenciesMtime(allDependencies)
    
    this.perFileCache.set(cacheKey, {
      entries,
      timestamp: Date.now(),
      dependenciesMtime
    })
  }

  private updateConfiguration(config: PreloadConfig): boolean {
    let needsSystemReload = false

    if (config.executable !== undefined && config.executable !== this.currentExecutable) {
      const resolvedGsPath = resolveGsExecutable(config.executable)
      this.gsRunner.setGsPath(resolvedGsPath)
      this.currentExecutable = resolvedGsPath
      needsSystemReload = true
    }

    const normalizedWorkingDir = config.workingDirectory || ''
    if (normalizedWorkingDir !== this.currentWorkingDirectory) {
      this.currentWorkingDirectory = normalizedWorkingDir
      needsSystemReload = true
    }

    const newBuildArgs = config.buildArgs || []
    if (!this.arraysEqual(newBuildArgs, this.currentBuildArgs)) {
      this.gsRunner.setBuildArgs(newBuildArgs)
      this.currentBuildArgs = newBuildArgs
      needsSystemReload = true
    }

    return needsSystemReload
  }

  private async getDependenciesMtime(files: string[]): Promise<number> {
    return this.computeDependenciesMtime(files)
  }

  private async computeDependenciesMtime(files: string[]): Promise<number> {
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

  private determineErrorType(error: unknown): PreloadError['errorType'] {
    const errorMessage = error instanceof Error ? error.message : String(error)
    if ((error as any)?.code === 'ENOENT') {
      return 'file-not-found'
    } else if (errorMessage.includes('syntax') || errorMessage.includes('parse')) {
      return 'parse-error'
    } else if (errorMessage.includes('Ghostscript') || errorMessage.includes('gs')) {
      return 'ghostscript-error'
    }
    return 'unknown'
  }

  private arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false
    }
    return true
  }

  invalidateCache(): void {
    this.systemLoaded = false
    this.systemEntries = []
    this.currentBuildArgs = []
    this.preloadErrors = []
    this.perFileCache.clear()
  }

  async getDictionaryStackInfo(config: PreloadConfig, currentFilePath?: string): Promise<DictionaryStackInfo> {
    const seenNames = new Set<string>()
    const mergedEntries: DictionaryEntry[] = []

    if (currentFilePath) {
      const cacheKey = await this.generateCacheKey(config)
      const cached = this.perFileCache.get(cacheKey)
      if (cached) {
        for (const entry of cached.entries) {
          if (!seenNames.has(entry.name)) {
            seenNames.add(entry.name)
            mergedEntries.push(entry)
          }
        }
      }
    }

    for (const entry of this.systemEntries) {
      if (!seenNames.has(entry.name)) {
        seenNames.add(entry.name)
        mergedEntries.push(entry)
      }
    }

    const stackDepth = currentFilePath && this.perFileCache.size > 0 ? 2 : 1

    return {
      entries: mergedEntries,
      stackDepth
    }
  }

  private async generateCacheKey(config: PreloadConfig): Promise<string> {
    const hashPart = async (paths: string[], name: string): Promise<string> => {
      if (paths.length === 0) {
        return `${name}:`
      }
      const sorted = [...paths].sort()
      const normalized = await Promise.all(sorted.map(resolveRealPath))
      const hash = djb2Hash(normalized.join('\0'))
      return `${name}:${hash}`
    }

    const hashString = (value: string | undefined, name: string): string => {
      if (!value) {
        return `${name}:`
      }
      return `${name}:${djb2Hash(value)}`
    }

    const [fileHash, workspaceHash, globalHash] = await Promise.all([
      hashPart(config.fileLevel || [], 'f'),
      hashPart(config.workspaceLevel || [], 'w'),
      hashPart(config.globalLevel || [], 'g')
    ])

    const buildArgs = (config.buildArgs || this.currentBuildArgs || []).join('|')
    const executable = config.executable || this.currentExecutable || ''
    const workingDir = config.workingDirectory || this.currentWorkingDirectory || ''

    const argsHash = hashString(buildArgs, 'a')
    const exeHash = executable ? `e:${djb2Hash(await resolveRealPath(executable))}` : 'e:'
    const dirHash = workingDir ? `d:${djb2Hash(await resolveRealPath(workingDir))}` : 'd:'

    return `v2|${fileHash}|${workspaceHash}|${globalHash}|${exeHash}|${dirHash}|${argsHash}`
  }

  setSystemEntries(entries: DictionaryEntry[]): void {
    this.systemEntries = entries
    this.systemLoaded = true
  }
}