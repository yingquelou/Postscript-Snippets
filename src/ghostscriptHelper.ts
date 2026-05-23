import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import * as path from 'path'

/**
 * Ghostscript 引擎选择策略的配置选项
 */
export interface GhostscriptResolutionOptions {
  explicitPath?: string
  configPath?: string
  autoDetect?: boolean
}

/**
 * Ghostscript 解析结果
 */
export interface GhostscriptResolutionResult {
  path: string | undefined
  source: 'explicit' | 'config' | 'auto-detect' | 'fallback'
}

/**
 * Check if an executable exists in PATH using system commands.
 */
export function checkExecutableExists(execName: string): string | undefined {
  try {
    if (process.platform === 'win32') {
      execSync(`where ${execName}`, { stdio: 'pipe', timeout: 3000 })
      return execName
    } else {
      execSync(`which ${execName}`, { stdio: 'pipe' })
      return execName
    }
  } catch {
    return undefined
  }
}

/**
 * Validate if a given path is a valid Ghostscript executable.
 */
export function validateGhostscriptPath(gsPath: string): boolean {
  try {
    const result = execSync(`"${gsPath}" --version`, { stdio: 'pipe', timeout: 5000 })
    const output = result.toString().trim()
    return output.toLowerCase().includes('ghostscript') || /^\d+\.\d+/.test(output)
  } catch {
    return false
  }
}

/**
 * Find the first available Ghostscript executable on Windows.
 * Uses only system commands, no manual file scanning.
 */
export function findWindowsGhostscript(): string | undefined {
  const candidates = ['gswin64c', 'gswin32c', 'gs']
  for (const candidate of candidates) {
    const found = checkExecutableExists(candidate)
    if (found && validateGhostscriptPath(found)) {
      return found
    }
  }
  return undefined
}

/**
 * Auto-detect Ghostscript from PATH
 */
export function autoDetectGhostscript(): string | undefined {
  if (process.platform === 'win32') {
    return findWindowsGhostscript()
  } else {
    const found = checkExecutableExists('gs')
    return found && validateGhostscriptPath(found) ? found : undefined
  }
}

/**
 * Resolve Ghostscript path with the following priority:
 * 1. User-provided path (from configuration)
 * 2. Auto-detect from PATH
 */
export function resolveGhostscriptPath(configPath?: string): string | undefined {
  if (configPath) {
    if (validateGhostscriptPath(configPath)) {
      return configPath
    }
    return undefined
  }
  return autoDetectGhostscript()
}

/**
 * Resolve Ghostscript executable with fallback to 'gs'
 */
export function resolveGsExecutable(configPath?: string): string {
  if (configPath) {
    const fromConfig = resolveGhostscriptPath(configPath)
    if (fromConfig) return fromConfig
  }
  return resolveGhostscriptPath() ?? 'gs'
}

/**
 * 统一的 Ghostscript 路径解析函数
 */
export function resolveGhostscript(options: GhostscriptResolutionOptions): GhostscriptResolutionResult {
  const { explicitPath, configPath, autoDetect = true } = options

  if (explicitPath) {
    if (validateGhostscriptPath(explicitPath)) {
      return { path: explicitPath, source: 'explicit' }
    }
  }

  if (configPath) {
    const validated = resolveGhostscriptPath(configPath)
    if (validated) {
      return { path: validated, source: 'config' }
    }
  }

  if (autoDetect) {
    const detected = autoDetectGhostscript()
    if (detected) {
      return { path: detected, source: 'auto-detect' }
    }
  }

  return { path: 'gs', source: 'fallback' }
}

/**
 * Normalize file path for consistent comparison
 */
export function normalizePath(p?: string): string | undefined {
  if (!p) return undefined

  const normalizePlatformPath = (pathStr: string): string => {
    if (process.platform === 'win32') {
      return pathStr.toLocaleLowerCase().replace(/\\/g, '/')
    }
    return pathStr
  }

  try {
    let p2 = ''
    if (p.startsWith('file://'))
      p2 = fileURLToPath(p)
    else
      p2 = path.normalize(path.resolve(p))
    return normalizePlatformPath(p2)
  } catch (e) {
    try {
      let p2 = path.normalize(p.replace(/^file:\/\//, ''))
      return normalizePlatformPath(p2)
    } catch { return normalizePlatformPath(p) }
  }
}
