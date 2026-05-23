import { DictionaryEntry, DictionaryStackInfo, PreloadConfig } from './completionTypes'
import { GhostscriptRunner } from './ghostscriptRunner'
import { resolveGsExecutable } from '../ghostscriptHelper'

import * as fs from 'fs'
import * as path from 'path'

export interface PreloadError {
  filePath: string
  level: 'global' | 'workspace' | 'file'
  message: string
  errorType: 'file-not-found' | 'parse-error' | 'ghostscript-error' | 'unknown'
}

interface FileCacheEntry {
  entries: DictionaryEntry[]
  mtime: number
}

export class DictionaryStackManager {
  private fileLevelEntries: DictionaryEntry[] = []
  private workspaceLevelEntries: DictionaryEntry[] = []
  private globalLevelEntries: DictionaryEntry[] = []
  private systemEntries: DictionaryEntry[] = []
  private gsRunner: GhostscriptRunner
  private fileLevelCacheKey: string = ''
  private workspaceLevelCacheKey: string = ''
  private globalLevelCacheKey: string = ''
  private systemLoaded: boolean = false
  private currentExecutable: string = ''
  private currentWorkingDirectory: string = ''
  private currentBuildArgs: string[] = []
  private fileLevelErrors: PreloadError[] = []
  private workspaceLevelErrors: PreloadError[] = []
  private globalLevelErrors: PreloadError[] = []
  
  private fileLevelFileCache: Map<string, FileCacheEntry> = new Map()
  private workspaceLevelFileCache: Map<string, FileCacheEntry> = new Map()
  private globalLevelFileCache: Map<string, FileCacheEntry> = new Map()

  constructor(psScriptsPath?: string, gsPath?: string) {
    const resolvedPsScriptsPath = psScriptsPath || path.join(process.cwd(), 'ps')
    const resolvedGsPath = resolveGsExecutable(gsPath)
    this.gsRunner = new GhostscriptRunner(resolvedGsPath, resolvedPsScriptsPath)
    this.currentExecutable = resolvedGsPath
  }

  getPreloadErrors(): PreloadError[] {
    return [...this.fileLevelErrors, ...this.workspaceLevelErrors, ...this.globalLevelErrors]
  }

  clearPreloadErrors(): void {
    this.fileLevelErrors = []
    this.workspaceLevelErrors = []
    this.globalLevelErrors = []
  }

  private clearErrorsForLevel(level: 'file' | 'workspace' | 'global'): void {
    switch (level) {
      case 'file':
        this.fileLevelErrors = []
        break
      case 'workspace':
        this.workspaceLevelErrors = []
        break
      case 'global':
        this.globalLevelErrors = []
        break
    }
  }

  async loadSystemEntries(force: boolean = false): Promise<void> {
    if (force || !this.systemLoaded) {
      try {
        this.systemEntries = await this.gsRunner.getDictionaryStack(this.currentWorkingDirectory || undefined)
        this.systemLoaded = true
      } catch (error) {
        console.error('[DictionaryStackManager] loadSystemEntries error:', error)
        this.systemEntries = []
        const errorMessage = error instanceof Error ? error.message : String(error)
        this.globalLevelErrors.push({
          filePath: 'system',
          level: 'global',
          message: `Failed to load system dictionary entries: ${errorMessage}`,
          errorType: 'ghostscript-error'
        })
      }
    }
  }

  async loadPreloadedEntries(config: PreloadConfig): Promise<void> {
    const fileLevelKey = JSON.stringify(config.fileLevel)
    const workspaceLevelKey = JSON.stringify(config.workspaceLevel)
    const globalLevelKey = JSON.stringify(config.globalLevel)

    if (config.executable !== this.currentExecutable) {
      const resolvedGsPath = resolveGsExecutable(config.executable || undefined)
      this.gsRunner.setGsPath(resolvedGsPath)
      this.currentExecutable = resolvedGsPath
      this.invalidateCache()
    }

    if (config.workingDirectory && config.workingDirectory !== this.currentWorkingDirectory) {
      this.currentWorkingDirectory = config.workingDirectory
      this.invalidateCache()
    }

    if (config.buildArgs && JSON.stringify(config.buildArgs) !== JSON.stringify(this.currentBuildArgs)) {
      this.gsRunner.setBuildArgs(config.buildArgs)
      this.currentBuildArgs = config.buildArgs
      this.invalidateCache()
    }

    await this.loadPreloadLevel('global', config.globalLevel, globalLevelKey)
    await this.loadPreloadLevel('workspace', config.workspaceLevel, workspaceLevelKey)
    await this.loadPreloadLevel('file', config.fileLevel, fileLevelKey)
  }

  private getFileCacheForLevel(level: 'file' | 'workspace' | 'global'): Map<string, FileCacheEntry> {
    switch (level) {
      case 'file':
        return this.fileLevelFileCache
      case 'workspace':
        return this.workspaceLevelFileCache
      case 'global':
        return this.globalLevelFileCache
    }
  }

  private async loadPreloadLevel(
    level: 'file' | 'workspace' | 'global',
    paths: string[],
    cacheKey: string
  ): Promise<void> {
    let currentKey = ''
    const fileCache = this.getFileCacheForLevel(level)

    switch (level) {
      case 'file':
        currentKey = this.fileLevelCacheKey
        break
      case 'workspace':
        currentKey = this.workspaceLevelCacheKey
        break
      case 'global':
        currentKey = this.globalLevelCacheKey
        break
    }

    if (currentKey === cacheKey) {
      const cachedPaths = new Set(fileCache.keys())
      const currentPaths = new Set(paths)
      
      const addedPaths = [...currentPaths].filter(p => !cachedPaths.has(p))
      const removedPaths = [...cachedPaths].filter(p => !currentPaths.has(p))
      
      if (addedPaths.length === 0 && removedPaths.length === 0) {
        let hasUpdates = false
        for (const filePath of paths) {
          const cached = fileCache.get(filePath)
          if (!cached) {
            hasUpdates = true
            break
          }
          try {
            const stats = await fs.promises.stat(filePath)
            if (stats.mtime.getTime() !== cached.mtime) {
              hasUpdates = true
              break
            }
          } catch {
            hasUpdates = true
            break
          }
        }
        if (!hasUpdates) {
          return
        }
      }
    }

    this.clearErrorsForLevel(level)
    
    const entries: DictionaryEntry[] = []
    
    const results = await Promise.all(paths.map(async (filePath) => {
      try {
        const stats = await fs.promises.stat(filePath)
        const currentMtime = stats.mtime.getTime()
        const cached = fileCache.get(filePath)
        
        if (cached && cached.mtime === currentMtime) {
          return { entries: cached.entries, filePath, success: true }
        }
        
        const fileEntries = await this.extractEntriesFromFile(filePath, this.currentWorkingDirectory || undefined)
        fileCache.set(filePath, { entries: fileEntries, mtime: currentMtime })
        
        return { entries: fileEntries, filePath, success: true }
      } catch (error) {
        console.error('[DictionaryStackManager] Error loading preload file:', error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        let errorType: PreloadError['errorType'] = 'unknown'
        
        if (errorMessage.includes('ENOENT') || errorMessage.includes('file not found')) {
          errorType = 'file-not-found'
        } else if (errorMessage.includes('syntax') || errorMessage.includes('parse')) {
          errorType = 'parse-error'
        } else if (errorMessage.includes('Ghostscript') || errorMessage.includes('gs')) {
          errorType = 'ghostscript-error'
        }
        
        return { error: { filePath, level, message: errorMessage, errorType }, success: false }
      }
    }))
    
    for (const result of results) {
      if (result.success) {
        entries.push(...result.entries!)
      } else {
        switch (level) {
          case 'file':
            this.fileLevelErrors.push(result.error!)
            break
          case 'workspace':
            this.workspaceLevelErrors.push(result.error!)
            break
          case 'global':
            this.globalLevelErrors.push(result.error!)
            break
        }
      }
    }

    switch (level) {
      case 'file':
        this.fileLevelEntries = entries
        this.fileLevelCacheKey = cacheKey
        break
      case 'workspace':
        this.workspaceLevelEntries = entries
        this.workspaceLevelCacheKey = cacheKey
        break
      case 'global':
        this.globalLevelEntries = entries
        this.globalLevelCacheKey = cacheKey
        break
    }
  }

  

  

  invalidateCache(): void {
    this.fileLevelCacheKey = ''
    this.workspaceLevelCacheKey = ''
    this.globalLevelCacheKey = ''
    this.systemLoaded = false
    this.fileLevelEntries = []
    this.workspaceLevelEntries = []
    this.globalLevelEntries = []
    this.currentBuildArgs = []
    this.clearPreloadErrors()
    this.fileLevelFileCache.clear()
    this.workspaceLevelFileCache.clear()
    this.globalLevelFileCache.clear()
  }

  getDictionaryStackInfo(): DictionaryStackInfo {
    const seenNames = new Set<string>()
    const mergedEntries: DictionaryEntry[] = []
    let stackDepth = 0

    for (const entries of [
      this.fileLevelEntries,
      this.workspaceLevelEntries,
      this.globalLevelEntries,
      this.systemEntries
    ]) {
      if (entries.length > 0) {
        stackDepth++
      }
      for (const entry of entries) {
        if (!seenNames.has(entry.name)) {
          seenNames.add(entry.name)
          mergedEntries.push(entry)
        }
      }
    }

    return {
      entries: mergedEntries,
      stackDepth
    }
  }

  setSystemEntries(entries: DictionaryEntry[]): void {
    this.systemEntries = entries
    this.systemLoaded = true
  }

  private async extractEntriesFromFile(filePath: string, workingDirectory?: string): Promise<DictionaryEntry[]> {
    const content = await fs.promises.readFile(filePath, 'utf-8')
    const manifestEntries = this.parsePreloadManifest(content)
    if (manifestEntries.length > 0) {
      return manifestEntries
    }
    if (this.looksLikePostScript(content)) {
      return await this.gsRunner.getDictionaryStackAfterPreload(filePath, workingDirectory)
    }
    return []
  }

  private looksLikePostScript(content: string): boolean {
    return /\b(def|load|begin|<<|>>|exec)\b/.test(content)
  }

  private parsePreloadManifest(content: string): DictionaryEntry[] {
    const entries: DictionaryEntry[] = []
    const lines = content.split('\n')
    let manifestLines = 0
    let matchedLines = 0

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('%')) continue

      manifestLines++
      const parts = trimmed.split(/\s+/)
      if (parts.length >= 2) {
        const name = parts[0].replace(/^\/?/, '')
        const type = parts[1].toLowerCase() as DictionaryEntry['type']
        if (name && ['array', 'boolean', 'dict', 'file', 'fontID', 'gstate', 'integer', 'mark', 'name', 'null', 'operator', 'packedarray', 'real', 'save', 'string'].includes(type)) {
          entries.push({ name, type })
          matchedLines++
        }
      }
    }

    if (manifestLines === 0 || matchedLines < manifestLines * 0.5) {
      return []
    }
    return entries
  }
}
