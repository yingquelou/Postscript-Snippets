import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeResult,
  Diagnostic,
  DiagnosticSeverity,
  DocumentSymbol,
  DocumentSymbolParams,
  Connection,
  CompletionItem,
  CompletionList,
  CompletionParams
} from 'vscode-languageserver/node'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { fileURLToPath } from 'url'
import * as path from 'path'
import * as fs from 'fs'
import { PsStrictLexer } from '../parser/postscriptParser'
import { containsBinaryData } from '../binaryDetector'
import { PostScriptSymbolBuilder } from './symbolBuilder'

import { DictionaryStackManager } from './dictionaryStackManager'
import { PreloadConfig, DICTIONARY_TYPE_KIND_MAP } from './completionTypes'
import {
  PROJECT_CONFIG_FILENAME,
  getProjectConfig,
  invalidateConfigCache,
  resolvePreloadConfig,
  isFileDeclared
} from './configUtils'
import {
  getCompletionPrefix,
  MAX_COMPLETION_ITEMS,
  filterSortAndLimitEntries
} from './completionUtils'
import { loadSnippetPrefixSet } from './snippetIndex'
import { buildPreloadConfigKey } from './cacheUtils'


const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)
let dictionaryStackManager: DictionaryStackManager | undefined
let managerGsPath: string | undefined
let systemEntriesLoadPromise: Promise<void> | undefined
let globalPsScriptsPath: string | undefined
let globalSnippetsPath: string | undefined
let snippetPrefixSet: ReadonlySet<string> = new Set()
let snippetIndexLoadPromise: Promise<void> | undefined

let lastPreloadConfig: PreloadConfig | undefined
let lastPreloadConfigKey: string = ''

function fileUriToFsPath(uri: string): string | undefined {
  try {
    return fileURLToPath(uri)
  } catch {
    return undefined
  }
}

async function getWorkspaceRoot(connection: Connection, preferredUri?: string): Promise<string | undefined> {
  const folders = await connection.workspace.getWorkspaceFolders()
  if (!folders || folders.length === 0) {
    return undefined
  }

  if (preferredUri) {
    const filePath = fileUriToFsPath(preferredUri)
    if (filePath) {
      const normalizedFilePath = path.normalize(filePath)
      for (const folder of folders) {
        try {
          const folderPath = fileURLToPath(folder.uri)
          const normalizedFolderPath = path.normalize(folderPath)
          if (
            normalizedFilePath === normalizedFolderPath ||
            normalizedFilePath.startsWith(normalizedFolderPath + path.sep)
          ) {
            return folderPath
          }
        } catch {
          continue
        }
      }
    }
  }

  try {
    return fileURLToPath(folders[0].uri)
  } catch {
    return undefined
  }
}



async function getGsPath(connection: Connection): Promise<string | undefined> {
  const config = await connection.workspace.getConfiguration('postscript.interpreter')
  return (config as any).executable
}

interface FeedbackManager {
  logError: (message: string, error?: unknown) => void
  logWarning: (message: string) => void
  logInfo: (message: string) => void
  sendDiagnostics: (uri: string, diagnostics: Diagnostic[]) => void
  sendPreloadDiagnostics: (manager: DictionaryStackManager, preferredUri?: string) => Promise<void>
  sendNotification: (method: string, params?: any) => void
}

function createFeedbackManager(connection: Connection): FeedbackManager {
  return {
    logError(message: string, error?: unknown): void {
      const errorDetails = error instanceof Error
        ? `${error.message}\n${error.stack || ''}`
        : String(error)
      connection.console.error(`[LanguageServer] ${message}:\n${errorDetails}`)
    },

    logWarning(message: string): void {
      connection.console.warn(`[LanguageServer] ${message}`)
    },

    logInfo(message: string): void {
      connection.console.log(`[LanguageServer] ${message}`)
    },

    sendDiagnostics(uri: string, diagnostics: Diagnostic[]): void {
      connection.sendDiagnostics({ uri, diagnostics })
    },

    async sendPreloadDiagnostics(manager: DictionaryStackManager, preferredUri?: string): Promise<void> {
      const workspaceRoot = await getWorkspaceRoot(connection, preferredUri)
      let configUri: string | undefined
      if (workspaceRoot) {
        const configPath = path.join(workspaceRoot, PROJECT_CONFIG_FILENAME)
        configUri = `file:///${configPath.replace(/\\/g, '/')}`
      }

      const errors = manager.getPreloadErrors()

      try {
        this.sendNotification('postscript/preloadDetails', {
          configUri,
          errors: errors.map(e => ({ level: e.level, filePath: e.filePath, message: e.message, errorType: e.errorType }))
        })
      } catch (error) {
        this.logError('Failed to send preload details notification', error)
      }
    },

    sendNotification(method: string, params?: any): void {
      connection.sendNotification(method, params)
    }
  }
}

function setupConnection(connection: Connection) {
  const feedback = createFeedbackManager(connection)

  function resetDictionaryStackManager(soft: boolean = false): void {
    if (!soft) {
      dictionaryStackManager = undefined
      managerGsPath = undefined
      systemEntriesLoadPromise = undefined
    }
    invalidateConfigCache()
    lastPreloadConfig = undefined
    lastPreloadConfigKey = ''
  }

  function startSystemEntriesLoad(manager: DictionaryStackManager): Promise<void> {
    if (!systemEntriesLoadPromise) {
      systemEntriesLoadPromise = manager.loadSystemEntries().catch((error) => {
        feedback.logError('Failed to load system entries', error)
      })
    }
    return systemEntriesLoadPromise
  }

  async function ensureDictionaryStackManager(): Promise<DictionaryStackManager> {
    const gsPath = await getGsPath(connection)
    if (dictionaryStackManager && managerGsPath !== gsPath) {
      resetDictionaryStackManager()
    }
    if (!dictionaryStackManager) {
      dictionaryStackManager = new DictionaryStackManager(globalPsScriptsPath, gsPath)
      managerGsPath = gsPath
      startSystemEntriesLoad(dictionaryStackManager)
    }
    return dictionaryStackManager
  }

  function ensureSnippetIndexLoaded(): Promise<void> {
    if (!snippetIndexLoadPromise && globalSnippetsPath) {
      snippetIndexLoadPromise = loadSnippetPrefixSet(globalSnippetsPath).then(prefixes => {
        snippetPrefixSet = prefixes
      })
    }
    return snippetIndexLoadPromise ?? Promise.resolve()
  }

  connection.onInitialize((): InitializeResult => {
    void ensureSnippetIndexLoaded()
    return {
      capabilities: {
        textDocumentSync: 1,
        documentSymbolProvider: true,
        completionProvider: {
          resolveProvider: true,
        }
      }
    }
  })



  connection.onDidChangeConfiguration(() => {
    resetDictionaryStackManager()
    void ensureDictionaryStackManager()
  })

  connection.onInitialized(async () => {
    try {
      const workspaceRoot = await getWorkspaceRoot(connection)
      await validateConfigFile(workspaceRoot)
      
      const manager = await ensureDictionaryStackManager()
      const preloadConfig = await getPreloadConfig()
      await manager.loadPreloadedEntries(preloadConfig, undefined)
      
      if (workspaceRoot) {
        const configPath = path.join(workspaceRoot, PROJECT_CONFIG_FILENAME)
        const configUri = `file:///${configPath.replace(/\\/g, '/')}`
        await feedback.sendPreloadDiagnostics(manager, configUri)
      }
      
      for (const doc of documents.all()) {
        void getOrParseDocument(doc).catch(error => {
          feedback.logError(`Error parsing document ${doc.uri} during initialization`, error)
        })
      }
    } catch (error) {
      feedback.logError('Error during language server initialization', error)
    }
  })

  connection.onDidChangeWatchedFiles(async params => {
    const workspaceRoot = await getWorkspaceRoot(connection)
    if (!workspaceRoot) return

    const configPath = path.join(workspaceRoot, PROJECT_CONFIG_FILENAME)
    const normalizedConfigPath = path.normalize(configPath)
    const configChanged = params.changes.some(change => {
      const fsPath = fileUriToFsPath(change.uri)
      return fsPath ? path.normalize(fsPath) === normalizedConfigPath : false
    })

    if (!configChanged) return

    resetDictionaryStackManager(true)
    await validateConfigFile(workspaceRoot)

    const manager = await ensureDictionaryStackManager()
    const preloadConfig = await getPreloadConfig()
    await manager.loadPreloadedEntries(preloadConfig, undefined)

    const configUri = `file:///${configPath.replace(/\\/g, '/')}`
    await feedback.sendPreloadDiagnostics(manager, configUri)
  })

  async function getPreloadConfig(currentFilePath?: string): Promise<PreloadConfig> {
    const workspaceRoot = await getWorkspaceRoot(connection, currentFilePath)
    const projectConfig = await getProjectConfig(workspaceRoot)

    const isUndeclared = !currentFilePath || !isFileDeclared(projectConfig.rawConfig.dependencies, currentFilePath, workspaceRoot)
    
    if (isUndeclared) {
      const configKey = await buildPreloadConfigKey(
        [],
        [],
        [],
        undefined,
        undefined,
        undefined,
        projectConfig.configDir,
        workspaceRoot
      )
      if (configKey === lastPreloadConfigKey && lastPreloadConfig) {
        return lastPreloadConfig
      }
      lastPreloadConfigKey = configKey
      lastPreloadConfig = {
        fileLevel: [],
        workspaceLevel: [],
        globalLevel: []
      }
      return lastPreloadConfig
    }

    const resolvedConfig = resolvePreloadConfig(projectConfig.rawConfig, currentFilePath, projectConfig.configDir, workspaceRoot)
    
    const configKey = await buildPreloadConfigKey(
      resolvedConfig.fileLevel,
      resolvedConfig.workspaceLevel,
      resolvedConfig.globalLevel,
      resolvedConfig.executable,
      resolvedConfig.workingDirectory,
      resolvedConfig.buildArgs?.join(' ') || '',
      projectConfig.configDir,
      workspaceRoot
    )

    if (configKey === lastPreloadConfigKey && lastPreloadConfig) {
      return lastPreloadConfig
    }

    lastPreloadConfigKey = configKey
    lastPreloadConfig = resolvedConfig
    return lastPreloadConfig
  }

  async function handleDictionaryStackInfo(): Promise<any> {
    const manager = await ensureDictionaryStackManager()
    const preloadConfig = await getPreloadConfig()
    await manager.loadPreloadedEntries(preloadConfig, undefined)
    await feedback.sendPreloadDiagnostics(manager, undefined)
    return manager.getDictionaryStackInfo(preloadConfig) || { entries: [], stackDepth: 0 }
  }

  connection.onRequest('getDictionaryStackInfo', handleDictionaryStackInfo)

  async function validateConfigFile(workspaceRoot?: string): Promise<void> {
    if (!workspaceRoot) return
    
    const configPath = path.join(workspaceRoot, PROJECT_CONFIG_FILENAME)
    if (!fs.existsSync(configPath)) return
    
    let raw = ''
    try {
      raw = await fs.promises.readFile(configPath, 'utf8')
      JSON.parse(raw)
    } catch (error: any) {
      const configUri = `file:///${configPath.replace(/\\/g, '/')}`
      const message = `Invalid JSON in ${PROJECT_CONFIG_FILENAME}: ${error instanceof Error ? error.message : String(error)}`
      
      let line = 0
      let column = 0
      if (error instanceof SyntaxError && raw) {
        const posMatch = error.message.match(/at position (\d+)/)
        if (posMatch && posMatch[1]) {
          const pos = parseInt(posMatch[1])
          const before = raw.substring(0, pos)
          line = before.split('\n').length - 1
          const lastNewline = before.lastIndexOf('\n')
          column = lastNewline >= 0 ? pos - lastNewline - 1 : pos
        }
      }
      
      const diagnostics: Diagnostic[] = [{
        severity: DiagnosticSeverity.Error,
        range: { start: { line, character: column }, end: { line, character: column + 1 } },
        message,
        source: 'postscript',
        code: 'PS005'
      }]
      feedback.sendDiagnostics(configUri, diagnostics)
    }
  }

  connection.onCompletion(async (params: CompletionParams): Promise<CompletionItem[] | CompletionList> => {
    try {
      const doc = documents.get(params.textDocument.uri)
      if (!doc) return []

      const manager = await ensureDictionaryStackManager()
      await startSystemEntriesLoad(manager)
      await ensureSnippetIndexLoaded()

      const text = doc.getText()
      const position = params.position

      const currentFilePath = fileUriToFsPath(params.textDocument.uri)
      const preloadConfig = await getPreloadConfig(currentFilePath)
      await manager.loadPreloadedEntries(preloadConfig, currentFilePath)
      
      // 发送预加载错误诊断到问题面板
      await feedback.sendPreloadDiagnostics(manager, params.textDocument.uri)

      const stackInfo = await manager.getDictionaryStackInfo(preloadConfig, currentFilePath)

      const line = text.split('\n')[position.line] ?? ''
      const prefix = getCompletionPrefix(line, position.character)

      const sortedResults = filterSortAndLimitEntries(stackInfo.entries, prefix, snippetPrefixSet)

      const items = sortedResults.slice(0, MAX_COMPLETION_ITEMS).map(result => ({
        label: result.entry.name,
        kind: DICTIONARY_TYPE_KIND_MAP[result.entry.type],
        detail: result.entry.type,
        sortText: result.sortText
      })) as CompletionItem[]

      if (sortedResults.length > MAX_COMPLETION_ITEMS) {
        return { isIncomplete: true, items }
      }
      return items
    } catch (error) {
      feedback.logError(`Error handling completion request: URI: ${params.textDocument.uri}`, error)
      return []
    }
  })

  connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
    return item
  })

  documents.onDidOpen(async change => {
    await validateTextDocument(change.document)
  })

  documents.onDidChangeContent(async change => {
    await validateTextDocument(change.document)
  })

  documents.onDidClose(event => {
    void parseCache.delete(event.document.uri)
  })


  /**
   * Check if parse errors are likely caused by binary data in the file.
   * Heuristic: many "unexpected character" errors with high offsets suggest binary data.
   */
  function isBinaryDataError(errors: any[], _textLength: number): boolean {
    if (errors.length < 5) return false
    const unexpectedCharErrors = errors.filter((e: any) =>
      e.message && e.message.includes('unexpected character')
    )
    return unexpectedCharErrors.length >= errors.length * 0.8
  }

  async function validateTextDocument(textDocument: TextDocument) {
    try {
      const { errors, isBinary } = await getOrParseDocument(textDocument)
      
      if (isBinary) {
        feedback.sendDiagnostics(textDocument.uri, [{
          severity: DiagnosticSeverity.Warning,
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          message: 'This file appears to contain binary data (e.g., embedded images). Document outline and debugging features are not supported for such files.',
          source: 'postscript',
          code: 'PS008'
        }])
        return
      }
      const diagnostics: Diagnostic[] = []
      
      if (errors && errors.length > 0) {
        if (isBinaryDataError(errors, textDocument.getText().length)) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            message: 'This file appears to contain binary data (e.g., embedded images). Document outline and debugging features are not supported for such files.',
            source: 'postscript',
            code: 'PS008'
          })
        } else {
          for (const err of errors) {
            const range = { 
              start: { line: (err.line ?? 1) - 1, character: (err.column ?? 1) - 1 }, 
              end: textDocument.positionAt((err.endOffset > 0 ? err.endOffset : (err.startOffset ?? 0)) + 1) 
            }
            const severity = (err as any).isWarning ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error;
            diagnostics.push({ 
              severity, 
              range, 
              message: err.message || 'Parse error', 
              source: 'postscript',
              code: severity === DiagnosticSeverity.Warning ? 'PS009' : 'PS001'
            })
          }
        }
      }
      
      feedback.sendDiagnostics(textDocument.uri, diagnostics)
    } catch (error) {
      feedback.logError(`Error validating document: URI: ${textDocument.uri}`, error)
      feedback.sendDiagnostics(textDocument.uri, [{
        severity: DiagnosticSeverity.Error,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        message: 'An unexpected error occurred while validating this document.',
        source: 'postscript',
        code: 'PS002'
      }])
    }
}

// === 线程安全的异步 LRU 缓存 ===
const MAX_CACHE_SIZE = 100

interface ParseCacheEntry {
  version: number
  tokens: any[]
  symbols: DocumentSymbol[]
  errors: any[]
  timestamp: number
  isBinary: boolean
}

class AsyncMutex {
  private queue: (() => void)[] = []
  private locked = false

  async acquire(): Promise<() => void> {
    return new Promise(resolve => {
      if (!this.locked) {
        this.locked = true
        resolve(() => this.release())
      } else {
        this.queue.push(() => {
          this.locked = true
          resolve(() => this.release())
        })
      }
    })
  }

  private release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!
      setImmediate(next)
    } else {
      this.locked = false
    }
  }
}

class ThreadSafeLRUCache<K, V> {
  private cache = new Map<K, V>()
  private maxSize: number
  private maxMemoryBytes: number = 50 * 1024 * 1024
  private currentMemoryBytes = 0
  private mutex = new AsyncMutex()
  private hits = 0
  private misses = 0

  constructor(maxSize: number) {
    this.maxSize = maxSize
  }

  private estimateSize(obj: any): number {
    try {
      return JSON.stringify(obj).length * 2
    } catch {
      return 1024
    }
  }

  async get(key: K): Promise<V | undefined> {
    const release = await this.mutex.acquire()
    try {
      const value = this.cache.get(key)
      if (value !== undefined) {
        this.hits++
        this.cache.delete(key)
        this.cache.set(key, value)
      } else {
        this.misses++
      }
      return value
    } finally {
      release()
    }
  }

  async set(key: K, value: V): Promise<void> {
    const release = await this.mutex.acquire()
    try {
      const oldValue = this.cache.get(key)
      if (oldValue) {
        this.currentMemoryBytes -= this.estimateSize(oldValue)
      }

      const newValueSize = this.estimateSize(value)
      while (this.cache.size >= this.maxSize || 
             (this.currentMemoryBytes + newValueSize) > this.maxMemoryBytes) {
        const firstKey = this.cache.keys().next().value
        if (firstKey !== undefined) {
          const removedValue = this.cache.get(firstKey)
          if (removedValue) {
            this.currentMemoryBytes -= this.estimateSize(removedValue)
          }
          this.cache.delete(firstKey)
        } else {
          break
        }
      }

      this.cache.set(key, value)
      this.currentMemoryBytes += newValueSize
    } finally {
      release()
    }
  }

  async has(key: K): Promise<boolean> {
    const release = await this.mutex.acquire()
    try {
      return this.cache.has(key)
    } finally {
      release()
    }
  }

  async delete(key: K): Promise<boolean> {
    const release = await this.mutex.acquire()
    try {
      const value = this.cache.get(key)
      if (value) {
        this.currentMemoryBytes -= this.estimateSize(value)
      }
      return this.cache.delete(key)
    } finally {
      release()
    }
  }

  get size(): number {
    return this.cache.size
  }

  get hitRate(): number {
    const total = this.hits + this.misses
    return total === 0 ? 0 : (this.hits / total) * 100
  }

  get memoryUsage(): number {
    return this.currentMemoryBytes
  }
}

const parseCache = new ThreadSafeLRUCache<string, ParseCacheEntry>(MAX_CACHE_SIZE)

const MAX_CACHE_AGE = 5 * 60 * 1000

async function getOrParseDocument(textDocument: TextDocument): Promise<ParseCacheEntry> {
  try {
    const uri = textDocument.uri
    const text = textDocument.getText()
    const version = textDocument.version
    const now = Date.now()
    
    const cached = await parseCache.get(uri)
    const isCacheValid = cached && 
      cached.version === version && 
      now - cached.timestamp < MAX_CACHE_AGE
    
    if (isCacheValid) {
      return cached
    }
    
    const isBinary = containsBinaryData(text)
    
    if (isBinary) {
      const entry: ParseCacheEntry = {
        version,
        tokens: [],
        symbols: [],
        errors: [],
        timestamp: Date.now(),
        isBinary: true
      }
      await parseCache.set(uri, entry)
      return entry
    }
    
    const lexResult = (PsStrictLexer as any).tokenize(text)
    const builder = new PostScriptSymbolBuilder()
    
    let symbols: DocumentSymbol[] = []
    let errors: any[] = []
    
    if (lexResult.errors.length > 0) {
      errors = lexResult.errors
    } else {
      const result = builder.parseFromTokens(lexResult.tokens, text)
      symbols = result.symbols
      errors = result.errors
    }
    
    const entry: ParseCacheEntry = {
      version,
      tokens: lexResult.tokens,
      symbols,
      errors,
      timestamp: Date.now(),
      isBinary: false
    }
    
    await parseCache.set(uri, entry)
    return entry
  } catch (error) {
    feedback.logError(`Error parsing document: URI: ${textDocument.uri}`, error)
    const fallbackEntry: ParseCacheEntry = {
      version: textDocument.version,
      tokens: [],
      symbols: [],
      errors: [{
        line: 1,
        column: 1,
        message: 'An unexpected error occurred while parsing this document.',
        startOffset: 0,
        endOffset: 0,
        isWarning: false
      }],
      timestamp: Date.now(),
      isBinary: false
    }
    await parseCache.set(textDocument.uri, fallbackEntry)
    return fallbackEntry
  }
}

  connection.onDocumentSymbol(async (params: DocumentSymbolParams) => {
    const doc = documents.get(params.textDocument.uri)
    if (!doc) return []
    
    try {
      const { symbols, isBinary } = await getOrParseDocument(doc)
      return isBinary ? [] : symbols
    } catch (error) {
      feedback.logError(`Error building document symbols: URI: ${params.textDocument.uri}`, error)
      return []
    }
  })
  
  connection.onShutdown(async () => {
    resetDictionaryStackManager()
  })
  
  documents.listen(connection)
}

export function startServer(reader?: any, writer?: any, psScriptsPath?: string, snippetsPath?: string) {
  globalPsScriptsPath = psScriptsPath
  globalSnippetsPath = snippetsPath
  snippetPrefixSet = new Set()
  snippetIndexLoadPromise = undefined
  let connection: Connection
  if (reader && writer) {
    connection = createConnection(reader, writer)
  } else {
    connection = createConnection(ProposedFeatures.all)
  }
  setupConnection(connection)
  connection.listen()
  return connection
}