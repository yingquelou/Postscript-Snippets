import * as path from 'path'
import * as fs from 'fs'

export const PROJECT_CONFIG_FILENAME = 'postscript.config.json'

export interface DependencyEntry {
  file: string
  inputs: string[]
  buildArgs?: string[]
  executable?: string
  workingDirectory?: string
}

export interface PostscriptProjectConfig {
  dependencies?: DependencyEntry[]
  workspaceDependencies?: string[]
  globalDependencies?: string[]
}

export interface PreloadConfig {
  fileLevel: string[]
  workspaceLevel: string[]
  globalLevel: string[]
  executable?: string
  workingDirectory?: string
  buildArgs?: string[]
}

interface ProjectConfigCache {
  rawConfig: PostscriptProjectConfig
  configDir: string
  mtime: number
}

// keyed by absolute config path so several configs can coexist (per-directory configs)
const projectConfigCacheMap = new Map<string, ProjectConfigCache>()
let configCacheLock = false
let configWaiters: (() => void)[] = []

async function acquireConfigLock(): Promise<void> {
  if (!configCacheLock) {
    configCacheLock = true
    return
  }
  return new Promise(resolve => configWaiters.push(resolve))
}

function releaseConfigLock(): void {
  configCacheLock = false
  if (configWaiters.length > 0) {
    const next = configWaiters.shift()
    if (next) next()
  }
}

export function normalizeConfigKey(key: string): string {
  if (!key) return ''
  let normalized = key.replace(/\\/g, '/')
  normalized = normalized.replace(/^\.+\//, '')
  normalized = normalized.replace(/^\//, '')
  normalized = path.normalize(normalized).replace(/\\/g, '/')
  return normalized
}

/**
 * Resolve a path declared in postscript.config.json.
 *
 * Single resolution base (issue: "路径解析收紧单一基准"): relative paths are
 * always resolved against the config file's directory (`configDir`). The
 * previous multi-level fallback (config → current file → workspace root)
 * made the same relative entry resolve to different files depending on which
 * document referenced it.
 *
 * `currentFilePath` is kept in the signature for compatibility but is no
 * longer used as a resolution base.
 */
export function resolveConfigPath(
  filePath: string,
  configDir?: string,
  _currentFilePath?: string,
  workspaceRoot?: string
): string {
  if (path.isAbsolute(filePath)) {
    return filePath
  }
  if (configDir) {
    return path.join(configDir, filePath)
  }
  if (workspaceRoot) {
    return path.join(workspaceRoot, filePath)
  }
  return path.resolve(filePath)
}

export function parseFileLevelPreloadConfig(
  rawValue: any
): Record<string, { inputs: string[], executable?: string, workingDirectory?: string, buildArgs?: string[] }> {
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

export function resolvePreloadConfig(
  rawConfig: PostscriptProjectConfig,
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
      resolveConfigPath(file, configDir, currentFilePath, workspaceRoot)
    ),
    workspaceLevel: Array.isArray(workspaceLevelRaw)
      ? workspaceLevelRaw
          .filter((p): p is string => typeof p === 'string')
          .map(file => resolveConfigPath(file, configDir, currentFilePath, workspaceRoot))
      : [],
    globalLevel: Array.isArray(globalLevelRaw)
      ? globalLevelRaw
          .filter((p): p is string => typeof p === 'string')
          .map(file => resolveConfigPath(file, configDir, currentFilePath, workspaceRoot))
      : [],
    executable: fileLevelConfig.executable
      ? resolveConfigPath(fileLevelConfig.executable, configDir, currentFilePath, workspaceRoot)
      : undefined,
    workingDirectory: fileLevelConfig.workingDirectory
      ? resolveConfigPath(fileLevelConfig.workingDirectory, configDir, currentFilePath, workspaceRoot)
      : undefined,
    buildArgs: fileLevelConfig.buildArgs
  }
}

/**
 * Walk up from `startDir` looking for postscript.config.json, stopping at
 * (and including) `stopDir` when given. Returns the absolute config path or
 * undefined. Enables configs placed next to the analyzed file rather than
 * only at the workspace root (issue: "getProjectConfig 只查 workspaceRoot").
 */
export async function findConfigPath(startDir: string, stopDir?: string): Promise<string | undefined> {
  const samePath = (a: string, b: string) =>
    path.normalize(a).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() ===
    path.normalize(b).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()

  let dir = path.resolve(startDir)
  const stop = stopDir ? path.resolve(stopDir) : undefined

  for (;;) {
    const candidate = path.join(dir, PROJECT_CONFIG_FILENAME)
    try {
      await fs.promises.access(candidate)
      return candidate
    } catch {
      // keep walking
    }
    if (stop && samePath(dir, stop)) {
      return undefined
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      return undefined
    }
    dir = parent
  }
}

async function loadConfigAt(configPath: string): Promise<{ rawConfig: PostscriptProjectConfig; configDir: string }> {
  await acquireConfigLock()
  try {
    const stats = await fs.promises.stat(configPath)
    const currentMtime = stats.mtime.getTime()
    const cached = projectConfigCacheMap.get(configPath)
    if (cached && cached.mtime === currentMtime) {
      return { rawConfig: cached.rawConfig, configDir: cached.configDir }
    }

    const raw = await fs.promises.readFile(configPath, 'utf8')
    const parsed = JSON.parse(raw) as PostscriptProjectConfig
    projectConfigCacheMap.set(configPath, {
      rawConfig: parsed && typeof parsed === 'object' ? parsed : {},
      configDir: path.dirname(configPath),
      mtime: currentMtime
    })

    const entry = projectConfigCacheMap.get(configPath)!
    return { rawConfig: entry.rawConfig, configDir: entry.configDir }
  } finally {
    releaseConfigLock()
  }
}

/**
 * Load the project config for a specific document: searches from the
 * document's directory upward to `workspaceRoot` (inclusive), then falls
 * back to the workspace root itself. Files without a config anywhere in
 * between get an empty config (L0 single-file analysis applies).
 */
export async function getProjectConfigForFile(
  currentFilePath: string | undefined,
  workspaceRoot?: string
): Promise<{ rawConfig: PostscriptProjectConfig; configDir?: string; configPath?: string }> {
  let configPath: string | undefined
  if (currentFilePath) {
    configPath = await findConfigPath(path.dirname(currentFilePath), workspaceRoot)
  }
  if (!configPath && workspaceRoot) {
    const rootCandidate = path.join(workspaceRoot, PROJECT_CONFIG_FILENAME)
    try {
      await fs.promises.access(rootCandidate)
      configPath = rootCandidate
    } catch {
      configPath = undefined
    }
  }
  if (!configPath) {
    return { rawConfig: {} }
  }
  try {
    const loaded = await loadConfigAt(configPath)
    return { ...loaded, configPath }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return { rawConfig: {} }
    }
    if (error instanceof SyntaxError) {
      // malformed JSON surfaces through config validation diagnostics; here
      // we degrade to an empty config so the LS stays functional
      return { rawConfig: {} }
    }
    return { rawConfig: {} }
  }
}

export async function getProjectConfig(workspaceRoot?: string): Promise<{ rawConfig: PostscriptProjectConfig; configDir?: string }> {
  if (!workspaceRoot) {
    return { rawConfig: {} }
  }
  const result = await getProjectConfigForFile(undefined, workspaceRoot)
  return { rawConfig: result.rawConfig, configDir: result.configDir }
}

export function invalidateConfigCache(): void {
  acquireConfigLock().then(() => {
    try {
      projectConfigCacheMap.clear()
    } finally {
      releaseConfigLock()
    }
  }).catch(() => {
    projectConfigCacheMap.clear()
  })
}

export function getConfigCacheStatus(): { exists: boolean; mtime?: number } {
  const first = projectConfigCacheMap.values().next()
  return {
    exists: projectConfigCacheMap.size > 0,
    mtime: first.done ? undefined : first.value.mtime
  }
}

/**
 * Decide whether a config target's `file` refers to the given document.
 *
 * Exact path matching only (issue: "同名文件静默错配"): the target file is
 * resolved against `configDir` and compared to the document path. The old
 * basename-only candidate made `foo.ps` in any directory match a config
 * entry for a different `foo.ps`. `workspaceRoot` is kept in the signature
 * for compatibility but is no longer an independent match base — callers
 * that have no configDir pass `configDir || workspaceRoot`.
 */
export function matchesCompileFile(configFile: string, currentFilePath: string, configDir: string, _workspaceRoot?: string): boolean {
  const normalizedCurrent = path.normalize(currentFilePath).replace(/\\/g, '/')

  const candidates = [
    path.normalize(path.resolve(configDir, configFile)).replace(/\\/g, '/')
  ]
  if (path.isAbsolute(configFile)) {
    candidates.push(path.normalize(configFile).replace(/\\/g, '/'))
  }

  return candidates.some(candidate => candidate === normalizedCurrent)
}

export function findDeclaredKey(
  rawValue: any,
  currentFilePath: string | undefined,
  workspaceRoot: string | undefined
): string | undefined {
  const mapping = parseFileLevelPreloadConfig(rawValue)
  if (!currentFilePath) {
    return undefined
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
      return key
    }
  }
  return undefined
}

export function isFileDeclared(rawValue: any, currentFilePath: string | undefined, workspaceRoot: string | undefined): boolean {
  return findDeclaredKey(rawValue, currentFilePath, workspaceRoot) !== undefined
}

/**
 * Semantic issues found in a parsed postscript.config.json. Reported as
 * diagnostics on the config file itself (PS010 error / PS011 warning).
 *
 * Note on cycles: the current schema declares flat preload lists, not a
 * dependency graph, so genuine cycles are not representable here. Only the
 * trivial self-reference (a target listing itself in its own inputs) is
 * detected; real cycle detection arrives with build-trace analysis.
 */
export interface ConfigIssue {
  level: 'error' | 'warning'
  message: string
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const stats = await fs.promises.stat(p)
    return stats.isFile()
  } catch {
    return false
  }
}

export async function validateProjectConfig(
  rawConfig: PostscriptProjectConfig,
  configDir: string,
  workspaceRoot?: string
): Promise<ConfigIssue[]> {
  const issues: ConfigIssue[] = []
  const resolve = (p: string) => resolveConfigPath(p, configDir, undefined, workspaceRoot)

  const checkMissing = async (p: string, what: string) => {
    const resolved = resolve(p)
    if (!(await fileExists(resolved))) {
      issues.push({
        level: 'error',
        message: `${what} "${p}" not found (resolved to ${resolved})`
      })
    }
  }

  if (rawConfig.dependencies !== undefined && !Array.isArray(rawConfig.dependencies)) {
    issues.push({ level: 'error', message: '"dependencies" must be an array of target entries' })
  }
  if (rawConfig.workspaceDependencies !== undefined && !Array.isArray(rawConfig.workspaceDependencies)) {
    issues.push({ level: 'error', message: '"workspaceDependencies" must be an array of file paths' })
  }
  if (rawConfig.globalDependencies !== undefined && !Array.isArray(rawConfig.globalDependencies)) {
    issues.push({ level: 'error', message: '"globalDependencies" must be an array of file paths' })
  }

  // duplicate target keys → silent precedence ambiguity
  const seenKeys = new Set<string>()
  const warnedDuplicates = new Set<string>()
  if (Array.isArray(rawConfig.dependencies)) {
    for (const entry of rawConfig.dependencies) {
      if (!entry || typeof entry !== 'object') {
        issues.push({ level: 'error', message: '"dependencies" contains a non-object entry' })
        continue
      }
      if (typeof entry.file !== 'string' || entry.file.length === 0) {
        issues.push({ level: 'error', message: 'a "dependencies" entry is missing its "file" key' })
        continue
      }
      if (entry.inputs !== undefined && !Array.isArray(entry.inputs)) {
        issues.push({ level: 'error', message: `target "${entry.file}": "inputs" must be an array of file paths` })
      }
      const key = normalizeConfigKey(entry.file)
      if (seenKeys.has(key) && !warnedDuplicates.has(key)) {
        warnedDuplicates.add(key)
        issues.push({
          level: 'warning',
          message: `target "${entry.file}" is declared more than once; only one entry can match a document`
        })
      }
      seenKeys.add(key)

      // trivial self-reference (real cycles need the build-trace graph)
      if (Array.isArray(entry.inputs) && entry.inputs.includes(entry.file)) {
        issues.push({ level: 'warning', message: `target "${entry.file}" lists itself in its own inputs` })
      }
    }

    for (const entry of rawConfig.dependencies) {
      if (!entry || typeof entry !== 'object' || typeof entry.file !== 'string') continue
      await checkMissing(entry.file, 'declared target file')
      if (Array.isArray(entry.inputs)) {
        for (const input of entry.inputs) {
          if (typeof input === 'string') await checkMissing(input, `input of target "${entry.file}"`)
        }
      }
    }
  }

  if (Array.isArray(rawConfig.workspaceDependencies)) {
    for (const p of rawConfig.workspaceDependencies) {
      if (typeof p === 'string') await checkMissing(p, 'workspace dependency')
    }
  }
  if (Array.isArray(rawConfig.globalDependencies)) {
    for (const p of rawConfig.globalDependencies) {
      if (typeof p === 'string') await checkMissing(p, 'global dependency')
    }
  }

  // cross-level duplicates: same file pulled in by two levels loads twice
  const collectLevel = (list: unknown): Set<string> => {
    const resolved = new Set<string>()
    if (Array.isArray(list)) {
      for (const p of list) {
        if (typeof p === 'string') resolved.add(normalizeConfigKey(resolve(p)))
      }
    }
    return resolved
  }
  const wsSet = collectLevel(rawConfig.workspaceDependencies)
  const globalSet = collectLevel(rawConfig.globalDependencies)
  for (const key of wsSet) {
    if (globalSet.has(key)) {
      issues.push({
        level: 'warning',
        message: `file "${key}" appears in both workspaceDependencies and globalDependencies and will be loaded twice`
      })
    }
  }

  return issues
}
