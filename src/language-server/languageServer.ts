import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeResult,
  Diagnostic,
  DiagnosticSeverity,
  DocumentSymbol,
  DocumentSymbolParams,
  SymbolKind,
  Range,
  Connection,
  CompletionItem,
  CompletionItemKind,
  CompletionList,
  CompletionParams
} from 'vscode-languageserver/node'
import { TextDocument } from 'vscode-languageserver-textdocument'
import type { CstNode } from 'chevrotain'
import { fileURLToPath } from 'url'
import * as path from 'path'
import * as fs from 'fs'
import { psParserHelper, PostScriptParser } from '../parser/postscriptParser'
import { DictionaryStackManager, PreloadError } from './dictionaryStackManager'
import { PreloadConfig } from './completionTypes'
import {
  getCompletionPrefix,
  MAX_COMPLETION_ITEMS,
  filterSortAndLimitEntries
} from './completionUtils'
import { loadSnippetPrefixSet } from './snippetIndex'


const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)
let dictionaryStackManager: DictionaryStackManager | undefined
let managerGsPath: string | undefined
let systemEntriesLoadPromise: Promise<void> | undefined
let globalPsScriptsPath: string | undefined
let globalSnippetsPath: string | undefined
let snippetPrefixSet: ReadonlySet<string> = new Set()
let snippetIndexLoadPromise: Promise<void> | undefined

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

const PROJECT_CONFIG_FILENAME = 'postscript.config.json'

interface ProjectCompletionConfig {
  rawConfig: any
  configDir?: string
}

let projectConfigCache: { rawConfig: any; configDir: string; mtime: number } | null = null

async function getProjectCompletionConfig(workspaceRoot?: string): Promise<ProjectCompletionConfig> {
  if (!workspaceRoot) {
    return { rawConfig: {} }
  }

  const configPath = path.join(workspaceRoot, PROJECT_CONFIG_FILENAME)
  
  try {
    const stats = await fs.promises.stat(configPath)
    const currentMtime = stats.mtime.getTime()
    
    if (projectConfigCache && projectConfigCache.mtime === currentMtime) {
      return {
        rawConfig: projectConfigCache.rawConfig,
        configDir: projectConfigCache.configDir
      }
    }
    
    const raw = await fs.promises.readFile(configPath, 'utf8')
    const parsed = JSON.parse(raw)
    projectConfigCache = {
      rawConfig: parsed && typeof parsed === 'object' ? parsed : {},
      configDir: path.dirname(configPath),
      mtime: currentMtime
    }
    
    return {
      rawConfig: projectConfigCache.rawConfig,
      configDir: projectConfigCache.configDir
    }
  } catch {
    return { rawConfig: {} }
  }
}

function normalizeConfigKey(key: string): string {
  if (!key) return ''
  let normalized = key.replace(/\\/g, '/')
  normalized = normalized.replace(/^\.+\//, '')
  normalized = normalized.replace(/^\//, '')
  normalized = path.normalize(normalized).replace(/\\/g, '/')
  return normalized
}

function resolvePreloadPath(
  filePath: string,
  currentFilePath?: string,
  configDir?: string,
  workspaceRoot?: string
): string {
  if (path.isAbsolute(filePath)) {
    return filePath
  }
  if (configDir) {
    return path.join(configDir, filePath)
  }
  if (currentFilePath) {
    return path.join(path.dirname(currentFilePath), filePath)
  }
  if (workspaceRoot) {
    return path.join(workspaceRoot, filePath)
  }
  return path.resolve(filePath)
}

export function parseFileLevelPreloadConfig(rawValue: any): Record<string, { inputs: string[], executable?: string, workingDirectory?: string, buildArgs?: string[] }> {
  const mapping: Record<string, { inputs: string[], executable?: string, workingDirectory?: string, buildArgs?: string[] }> = {}

  if (!Array.isArray(rawValue)) {
    return mapping
  }

  for (const item of rawValue as Array<unknown>) {
    if (!item || typeof item !== 'object') continue
    const file = typeof (item as any).file === 'string' ? (item as any).file : undefined
    const pathList = Array.isArray((item as any).inputs)
      ? (item as any).inputs.filter((p: unknown): p is string => typeof p === 'string')
      : []
    const executable = typeof (item as any).executable === 'string' ? (item as any).executable : undefined
    const workingDirectory = typeof (item as any).workingDirectory === 'string' ? (item as any).workingDirectory : undefined
    const buildArgs = Array.isArray((item as any).buildArgs)
      ? (item as any).buildArgs.filter((p: unknown): p is string => typeof p === 'string')
      : undefined
    if (file) {
      mapping[normalizeConfigKey(file)] = {
        inputs: pathList,
        executable,
        workingDirectory,
        buildArgs
      }
    }
  }
  return mapping
}

export function resolveFileLevelPreloadPaths(
  rawValue: any,
  currentFilePath: string | undefined,
  workspaceRoot: string | undefined
): { inputs: string[], executable?: string, workingDirectory?: string, buildArgs?: string[] } {
  const mapping = parseFileLevelPreloadConfig(rawValue)
  if (!currentFilePath) {
    return mapping['*'] || { inputs: [] }
  }

  const resolvedKeys: string[] = []
  const absoluteKey = normalizeConfigKey(currentFilePath)
  resolvedKeys.push(absoluteKey)
  if (workspaceRoot) {
    const relativeKey = normalizeConfigKey(path.relative(workspaceRoot, currentFilePath))
    if (relativeKey && relativeKey !== absoluteKey) {
      resolvedKeys.push(relativeKey)
    }
  }
  const basenameKey = normalizeConfigKey(path.basename(currentFilePath))
  if (basenameKey && !resolvedKeys.includes(basenameKey)) {
    resolvedKeys.push(basenameKey)
  }

  for (const key of resolvedKeys) {
    if (mapping[key]) {
      return mapping[key]
    }
  }
  return mapping['*'] || { inputs: [] }
}

function resolvePreloadConfig(
  rawConfig: any,
  currentFilePath: string | undefined,
  configDir: string | undefined,
  workspaceRoot: string | undefined
): PreloadConfig {
  const fileLevelRaw = rawConfig?.dependencies
  const workspaceLevelRaw = rawConfig?.workspaceDependencies
  const globalLevelRaw = rawConfig?.globalDependencies

  const fileLevelConfig = resolveFileLevelPreloadPaths(fileLevelRaw, currentFilePath, workspaceRoot)

  return {
    fileLevel: fileLevelConfig.inputs.map(file =>
      resolvePreloadPath(file, currentFilePath, configDir, workspaceRoot)
    ),
    workspaceLevel: Array.isArray(workspaceLevelRaw)
      ? workspaceLevelRaw
          .filter((p): p is string => typeof p === 'string')
          .map(file => resolvePreloadPath(file, currentFilePath, configDir, workspaceRoot))
      : [],
    globalLevel: Array.isArray(globalLevelRaw)
      ? globalLevelRaw
          .filter((p): p is string => typeof p === 'string')
          .map(file => resolvePreloadPath(file, currentFilePath, configDir, workspaceRoot))
      : [],
    executable: fileLevelConfig.executable
      ? resolvePreloadPath(fileLevelConfig.executable, currentFilePath, configDir, workspaceRoot)
      : undefined,
    workingDirectory: fileLevelConfig.workingDirectory
      ? resolvePreloadPath(fileLevelConfig.workingDirectory, currentFilePath, configDir, workspaceRoot)
      : undefined,
    buildArgs: fileLevelConfig.buildArgs
  }
}

async function getGsPath(connection: Connection): Promise<string | undefined> {
  const config = await connection.workspace.getConfiguration('postscript.interpreter')
  return (config as any).executable
}

function setupConnection(connection: Connection) {
  function resetDictionaryStackManager(): void {
    dictionaryStackManager = undefined
    managerGsPath = undefined
    systemEntriesLoadPromise = undefined
  }

  function startSystemEntriesLoad(manager: DictionaryStackManager): Promise<void> {
    if (!systemEntriesLoadPromise) {
      systemEntriesLoadPromise = manager.loadSystemEntries().catch((error) => {
        console.error('[LanguageServer] Failed to load system entries:', error)
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
          triggerCharacters: ['/', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z']
        }
      }
    }
  })



  connection.onDidChangeConfiguration(() => {
    resetDictionaryStackManager()
    void ensureDictionaryStackManager()
  })

  connection.onInitialized(async () => {
    const workspaceRoot = await getWorkspaceRoot(connection)
    await validateConfigFile(workspaceRoot)
    
    const manager = await ensureDictionaryStackManager()
    const preloadConfig = await getPreloadConfig()
    await manager.loadPreloadedEntries(preloadConfig)
    
    if (workspaceRoot) {
      const configPath = path.join(workspaceRoot, PROJECT_CONFIG_FILENAME)
      const configUri = `file:///${configPath.replace(/\\/g, '/')}`
      await sendPreloadDiagnostics(manager, configUri, true)
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

    resetDictionaryStackManager()
    await validateConfigFile(workspaceRoot)

    const manager = await ensureDictionaryStackManager()
    const preloadConfig = await getPreloadConfig()
    await manager.loadPreloadedEntries(preloadConfig)

    const configUri = `file:///${configPath.replace(/\\/g, '/')}`
    await sendPreloadDiagnostics(manager, configUri, false)
  })

  async function getPreloadConfig(currentFilePath?: string): Promise<PreloadConfig> {
    const workspaceRoot = await getWorkspaceRoot(connection, currentFilePath)
    const projectConfig = await getProjectCompletionConfig(workspaceRoot)
    return resolvePreloadConfig(projectConfig.rawConfig, currentFilePath, projectConfig.configDir, workspaceRoot)
  }

  async function handleDictionaryStackInfo(): Promise<any> {
    await ensureDictionaryStackManager()
    const preloadConfig = await getPreloadConfig()
    await dictionaryStackManager?.loadPreloadedEntries(preloadConfig)
    return dictionaryStackManager?.getDictionaryStackInfo() || { entries: [], stackDepth: 0 }
  }

  connection.onRequest('getDictionaryStackInfo', handleDictionaryStackInfo)

  let lastPreloadDiagnosticsKey = ''
  let lastConfigValidationMessage = ''

  async function sendPreloadDiagnostics(manager: DictionaryStackManager, configUri?: string, showMessage: boolean = false): Promise<void> {
    const errors = manager.getPreloadErrors()
    const diagnostics: Diagnostic[] = errors.map(error => ({
      severity: error.errorType === 'file-not-found' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      message: formatPreloadErrorMessage(error),
      source: 'postscript'
    }))

    if (configUri) {
      connection.sendDiagnostics({ uri: configUri, diagnostics })
    }

    const diagnosticsKey = diagnostics
      .map(d => `${d.severity}:${d.message}`)
      .join('|')

    if (showMessage) {
      if (diagnostics.length > 0 && diagnosticsKey !== lastPreloadDiagnosticsKey) {
        // Keep popups optional; default feedback is via diagnostics + notification
        connection.window.showWarningMessage(
          'PostScript preload errors were detected. Open postscript.config.json for details in the Problems panel.'
        )
      } else if (diagnostics.length === 0 && lastPreloadDiagnosticsKey) {
        connection.window.showInformationMessage('PostScript preload issues have been resolved.')
      }
    }

    lastPreloadDiagnosticsKey = diagnosticsKey
    // Send a structured notification with full error details so the client can
    // present the information in a non-modal, discoverable UI (output channel / status bar).
    try {
      connection.sendNotification('postscript/preloadDetails', {
        configUri,
        errors: errors.map(e => ({ level: e.level, filePath: e.filePath, message: e.message, errorType: e.errorType }))
      })
    } catch (error) {
      console.error('[LanguageServer] Failed to send preload details notification:', error)
    }
  }

  function formatPreloadErrorMessage(error: PreloadError): string {
    const levelNames = {
      global: 'Global',
      workspace: 'Workspace',
      file: 'File'
    }
    const typeNames = {
      'file-not-found': 'File not found',
      'parse-error': 'Parse error',
      'ghostscript-error': 'Ghostscript error',
      'unknown': 'Unknown error'
    }
    
    return `${levelNames[error.level]} dependency error [${typeNames[error.errorType]}]: ${error.filePath}\n${error.message}`
  }

  async function validateConfigFile(workspaceRoot?: string): Promise<void> {
    if (!workspaceRoot) return
    
    const configPath = path.join(workspaceRoot, PROJECT_CONFIG_FILENAME)
    if (!fs.existsSync(configPath)) return
    
    try {
      const raw = await fs.promises.readFile(configPath, 'utf8')
      JSON.parse(raw)
      lastConfigValidationMessage = ''
    } catch (error) {
      const configUri = `file:///${configPath.replace(/\\/g, '/')}`
      const message = `Invalid JSON in ${PROJECT_CONFIG_FILENAME}: ${error instanceof Error ? error.message : String(error)}`
      const diagnostics: Diagnostic[] = [{
        severity: DiagnosticSeverity.Error,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        message,
        source: 'postscript'
      }]
      connection.sendDiagnostics({ uri: configUri, diagnostics })
      if (message !== lastConfigValidationMessage) {
        connection.window.showErrorMessage(message)
        lastConfigValidationMessage = message
      }
    }
  }

  connection.onCompletion(async (params: CompletionParams): Promise<CompletionItem[] | CompletionList> => {
    const doc = documents.get(params.textDocument.uri)
    if (!doc) return []

    const manager = await ensureDictionaryStackManager()
    await startSystemEntriesLoad(manager)
    await ensureSnippetIndexLoaded()

    const text = doc.getText()
    const position = params.position

    const currentFilePath = fileUriToFsPath(params.textDocument.uri)
    const preloadConfig = await getPreloadConfig(currentFilePath)
    await manager.loadPreloadedEntries(preloadConfig)

    const stackInfo = manager.getDictionaryStackInfo()

    const line = text.split('\n')[position.line] ?? ''
    const prefix = getCompletionPrefix(line, position.character)

    const sortedResults = filterSortAndLimitEntries(stackInfo.entries, prefix, snippetPrefixSet)

    const kindMap: Record<string, CompletionItemKind> = {
      operator: CompletionItemKind.Function,
      array: CompletionItemKind.Value,
      packedarray: CompletionItemKind.Value,
      string: CompletionItemKind.Value,
      integer: CompletionItemKind.Value,
      real: CompletionItemKind.Value,
      boolean: CompletionItemKind.Constant,
      dict: CompletionItemKind.Module,
      name: CompletionItemKind.Variable,
      file: CompletionItemKind.File,
      fontID: CompletionItemKind.Field,
      gstate: CompletionItemKind.Field,
      mark: CompletionItemKind.Constant,
      null: CompletionItemKind.Constant,
      save: CompletionItemKind.Constant,
      any: CompletionItemKind.Property
    }

    const items = sortedResults.slice(0, MAX_COMPLETION_ITEMS).map(result => ({
      label: result.entry.name,
      kind: kindMap[result.entry.type] || CompletionItemKind.Property,
      detail: result.entry.type,
      sortText: result.sortText
    })) as CompletionItem[]

    if (sortedResults.length > MAX_COMPLETION_ITEMS) {
      return { isIncomplete: true, items }
    }
    return items
  })

  connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
    return item
  })

  documents.onDidChangeContent(change => {
    validateTextDocument(change.document)
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
    const text = textDocument.getText()
    const res: any = psParserHelper(text)
    const diagnostics: Diagnostic[] = []
    if (res && res.errors && res.errors.length) {
      if (isBinaryDataError(res.errors, text.length)) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          message: 'This file appears to contain binary data (e.g., embedded images). Document outline and debugging features are not supported for such files.',
          source: 'postscript'
        })
      } else {
        for (const err of res.errors) {
          let startOffset = 0
          let endOffset = 1
          if (err.token && typeof err.token.startOffset === 'number') {
            startOffset = err.token.startOffset
            endOffset = typeof err.token.endOffset === 'number' ? err.token.endOffset : startOffset + 1
          }
          const range = { start: textDocument.positionAt(startOffset), end: textDocument.positionAt(endOffset) }
          diagnostics.push({ severity: DiagnosticSeverity.Error, range, message: err.message || JSON.stringify(err), source: 'postscript' })
        }
      }
    }
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics })
}

// === Document Symbol 相关的常量和辅助函数 ===
const POSTSCRIPT_SYMBOL_TYPE_MAP: Record<string, SymbolKind> = {
  array: SymbolKind.Array,
  dictionary: SymbolKind.Object,
  string: SymbolKind.String,
  Number: SymbolKind.Number,
  LiteralName: SymbolKind.Key,
  ExecutableName: SymbolKind.Function,
  procedure: SymbolKind.Array
}

const POSTSCRIPT_SYMBOL_VIEW: Record<string, string> = {
  array: '[...]',
  dictionary: '<<...>>',
  string: '(...)',
  procedure: '{...}'
}

function getPostScriptLocationRange(location: any): Range {
  const startLine = (location.startLine || 1) - 1
  const startCol = (location.startColumn || 1) - 1
  const endLine = (location.endLine || 1) - 1
  const endCol = location.endColumn || startCol
  return { 
    start: { line: startLine, character: startCol }, 
    end: { line: endLine, character: endCol } 
  }
}

// 缓存 VisitorConstructor（不需要每次都重新生成）
let cachedPostScriptVisitorConstructor: any = null

function getPostScriptVisitorConstructor() {
  if (!cachedPostScriptVisitorConstructor) {
    const parser = new PostScriptParser()
    cachedPostScriptVisitorConstructor = parser.getBaseCstVisitorConstructorWithDefaults()
  }
  return cachedPostScriptVisitorConstructor
}

// 符号树缓存（使用文档版本号控制失效）
interface SymbolCacheEntry {
  symbols: DocumentSymbol[]
  version: number
}
const symbolCache = new Map<string, SymbolCacheEntry>()

/**
 * 构建 PostScript 文档符号的辅助函数
 */
function buildPostScriptSymbols(doc: TextDocument, cst: CstNode): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = []
  const VisitorCtor = getPostScriptVisitorConstructor()
  
  class PostScriptSymbolVisitor extends VisitorCtor {
    private document: TextDocument
    constructor(document: TextDocument) {
      super()
      this.document = document
    }
    expression(ctx: CstNode, ss: DocumentSymbol[]) {
      for (const key in ctx) {
        const token: any = (ctx as any)[key][0]
        switch (key) {
          case 'array':
          case 'dictionary':
          case 'procedure':
          case 'string':
            const range = getPostScriptLocationRange(token.location)
            const name = key === 'string' ? this.document.getText(range) : POSTSCRIPT_SYMBOL_VIEW[key]
            const sym: DocumentSymbol = { name, kind: POSTSCRIPT_SYMBOL_TYPE_MAP[key] || SymbolKind.String, range, selectionRange: range, children: [] }
            ss.push(sym)
            if (token.children && token.children.expression && key !== 'string') {
              this.visit(token, sym.children)
            }
            break
          case 'LiteralName':
            let literalLocation = token as any
            if (literalLocation.location) literalLocation = literalLocation.location
            const lr = getPostScriptLocationRange(literalLocation)
            const literalLabel = token.image?.replace(/^\//, '') || key
            ss.push({ name: literalLabel, kind: POSTSCRIPT_SYMBOL_TYPE_MAP[key] || SymbolKind.Key, range: lr, selectionRange: lr, children: [] })
            break
          default:
            let defaultLocation = token as any
            if (defaultLocation.location) defaultLocation = defaultLocation.location
            const r = getPostScriptLocationRange(defaultLocation)
            const label = token.image || key
            ss.push({ name: label, kind: POSTSCRIPT_SYMBOL_TYPE_MAP[key] || SymbolKind.String, range: r, selectionRange: r, children: [] })
            break
        }
      }
    }
  }

  const visitor = new PostScriptSymbolVisitor(doc)
  visitor.visit(cst, symbols)
  return symbols
}

  connection.onDocumentSymbol((params: DocumentSymbolParams) => {
    const doc = documents.get(params.textDocument.uri)
    if (!doc) return []
    
    // 检查缓存
    const cached = symbolCache.get(params.textDocument.uri)
    if (cached && cached.version === doc.version) {
      return cached.symbols
    }
    
    const text = doc.getText()
    const { errors, cst } = psParserHelper(text)
    if (errors && errors.length) {
      console.error('[DocumentSymbol] Parse errors:', errors)
      return []
    }
    if (!cst) return []

    const symbols = buildPostScriptSymbols(doc, cst)
    
    // 更新缓存
    symbolCache.set(params.textDocument.uri, {
      symbols,
      version: doc.version
    })
    
    return symbols
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