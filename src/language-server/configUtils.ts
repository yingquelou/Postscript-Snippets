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

let projectConfigCache: ProjectConfigCache | null = null
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

export function resolveConfigPath(
  filePath: string,
  configDir?: string,
  currentFilePath?: string,
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

export async function getProjectConfig(workspaceRoot?: string): Promise<{ rawConfig: PostscriptProjectConfig; configDir?: string }> {
  if (!workspaceRoot) {
    return { rawConfig: {} }
  }

  const configPath = path.join(workspaceRoot, PROJECT_CONFIG_FILENAME)

  await acquireConfigLock()
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
    const parsed = JSON.parse(raw) as PostscriptProjectConfig
    projectConfigCache = {
      rawConfig: parsed && typeof parsed === 'object' ? parsed : {},
      configDir: path.dirname(configPath),
      mtime: currentMtime
    }

    return {
      rawConfig: projectConfigCache.rawConfig,
      configDir: projectConfigCache.configDir
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return { rawConfig: {} }
    }
    return { rawConfig: {} }
  } finally {
    releaseConfigLock()
  }
}

export function invalidateConfigCache(): void {
  acquireConfigLock().then(() => {
    try {
      projectConfigCache = null
    } finally {
      releaseConfigLock()
    }
  }).catch(() => {
    projectConfigCache = null
  })
}

export function getConfigCacheStatus(): { exists: boolean; mtime?: number } {
  return {
    exists: projectConfigCache !== null,
    mtime: projectConfigCache?.mtime
  }
}

export function matchesCompileFile(configFile: string, currentFilePath: string, configDir: string, workspaceRoot: string): boolean {
  const normalizedCurrent = path.normalize(currentFilePath).replace(/\\/g, '/')
  
  const candidatePaths = [
    path.normalize(path.resolve(configDir, configFile)).replace(/\\/g, '/'),
    path.normalize(path.resolve(workspaceRoot, configFile)).replace(/\\/g, '/'),
    path.normalize(configFile).replace(/\\/g, '/'),
    path.normalize(path.basename(configFile)).replace(/\\/g, '/')
  ]

  return candidatePaths.some(candidate => candidate === normalizedCurrent)
}

export function isFileDeclared(rawValue: any, currentFilePath: string | undefined, workspaceRoot: string | undefined): boolean {
  const mapping = parseFileLevelPreloadConfig(rawValue)
  if (!currentFilePath) {
    return false
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
      return true
    }
  }
  return false
}