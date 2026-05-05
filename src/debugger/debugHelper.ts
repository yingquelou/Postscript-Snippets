import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { ParsedConfiguration } from './debugConfigurationParser'

/**
 * Check if an executable exists in PATH.
 * Returns the executable name if found, undefined otherwise.
 */
export function checkExecutableExists(execName: string): string | undefined {
  try {
    // Use 'where' on Windows, 'which' on other platforms
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    execSync(`${cmd} ${execName}`, { stdio: 'pipe' })
    return execName
  } catch {
    return undefined
  }
}

/**
 * Validate if a given path is a valid Ghostscript executable.
 * Handles both full paths and simple executable names (which will be looked up in PATH).
 * @param gsPath The path or executable name to validate
 * @returns True if valid, false otherwise
 */
export function validateGhostscriptPath(gsPath: string): boolean {
  try {
    // Check if this is just a simple executable name (no path separators)
    const hasPathSeparator = gsPath.includes('/') || (process.platform === 'win32' && gsPath.includes('\\'))
    
    if (hasPathSeparator) {
      // It's a path - resolve and check existence
      const resolvedPath = path.resolve(gsPath)
      if (!fs.existsSync(resolvedPath)) {
        return false
      }

      // Check if it's a file (not a directory)
      const stat = fs.statSync(resolvedPath)
      if (!stat.isFile()) {
        return false
      }

      // On non-Windows, check if it's executable
      if (process.platform !== 'win32') {
        if (!(stat.mode & 0o111)) {
          return false
        }
      }
    } else {
      // It's just a filename - check if it exists in PATH
      const cmd = process.platform === 'win32' ? 'where' : 'which'
      execSync(`${cmd} ${gsPath}`, { stdio: 'pipe' })
    }

    // Try to run gs --version to verify it's actually Ghostscript
    const result = execSync(`"${gsPath}" --version`, { stdio: 'pipe', timeout: 5000 })
    const output = result.toString().trim()
    return output.toLowerCase().includes('ghostscript') || /^\d+\.\d+/.test(output)
  } catch {
    return false
  }
}

/**
 * Find the first available Ghostscript executable on Windows.
 * Checks in order: gswin64c, gswin32c, gs (for MSYS/MSYS2/Cygwin compatibility)
 */
export function findWindowsGhostscript(): string | undefined {
  // Check in order of preference
  return checkExecutableExists('gswin64c')
    || checkExecutableExists('gswin32c')
    || checkExecutableExists('gs')
}

/**
 * Resolve Ghostscript path with the following priority:
 * 1. launch.json ghostscriptPath (already merged with VS Code setting by extension.ts)
 * 2. Auto-detect from PATH (Windows: gswin64c/gswin32c/gs, Others: gs)
 * @returns The resolved path, or undefined if no valid Ghostscript found
 */
export function resolveGhostscriptPath(argsPath?: string): string | undefined {
  // Priority 1: launch.json configuration (already resolved by extension.ts)
  if (argsPath) {
    // Validate user-provided path
    if (validateGhostscriptPath(argsPath)) {
      return argsPath
    }
    return undefined
  }

  // Priority 2: Auto-detect from PATH
  let detectedPath: string | undefined
  if (process.platform === 'win32') {
    detectedPath = findWindowsGhostscript()
  } else {
    detectedPath = checkExecutableExists('gs')
  }

  // Validate detected path
  if (detectedPath && validateGhostscriptPath(detectedPath)) {
    return detectedPath
  }

  return undefined
}

/**
 * Normalize file path for consistent comparison
 * Handles file:// URLs, resolves relative paths and normalizes platform-specific paths
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
      // fallback simple cleanup
      let p2 = path.normalize(p.replace(/^file:\/\//, ''))
      return normalizePlatformPath(p2)
    } catch { return normalizePlatformPath(p) }
  }
}

/**
 * Parse and validate launch configuration arguments
 * Returns parsed configuration or validation errors
 */
export function parseLaunchArguments(args: any): { success: boolean; config?: ParsedConfiguration; errors?: Array<{ field: string; message: string; suggestion: string }> } {
  const errors: Array<{ field: string; message: string; suggestion: string }> = []
  const config: Partial<ParsedConfiguration> = {}

  if (!args.program) {
    errors.push({
      field: 'program',
      message: 'No program provided in launch configuration',
      suggestion: 'Please specify the PostScript file to debug in the "program" field.'
    })
  } else {
    const resolvedProgram = path.resolve(args.cwd || process.cwd(), args.program)
    if (!fs.existsSync(resolvedProgram)) {
      errors.push({
        field: 'program',
        message: `Program file not found: ${resolvedProgram}`,
        suggestion: 'Please check that the program path is correct.'
      })
    } else {
      config.program = resolvedProgram
    }
  }

  const gsPath = resolveGhostscriptPath(args.ghostscriptPath)
  if (!gsPath) {
    errors.push({
      field: 'ghostscriptPath',
      message: args.ghostscriptPath
        ? `Invalid Ghostscript path: ${args.ghostscriptPath}`
        : 'Ghostscript executable not found',
      suggestion: 'Please install Ghostscript and ensure it is in your PATH, or specify the path in launch.json.'
    })
  } else {
    config.ghostscriptPath = gsPath
  }

  const cwd = args.cwd || (config.program ? path.dirname(config.program) : process.cwd())
  if (!fs.existsSync(cwd)) {
    errors.push({
      field: 'cwd',
      message: `Working directory not found: ${cwd}`,
      suggestion: 'Please check that the working directory path is correct.'
    })
  } else {
    config.cwd = cwd
  }

  config.args = args.args && Array.isArray(args.args)
    ? args.args.map((v: string) => v.trim()).filter((v: string) => v !== '' && v !== '-')
    : []

  config.stopOnEntry = args.stopOnEntry !== undefined ? args.stopOnEntry : false

  if (errors.length > 0) {
    return { success: false, errors }
  }

  return { success: true, config: config as ParsedConfiguration }
}

