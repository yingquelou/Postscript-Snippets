import * as fs from 'fs'
import * as path from 'path'
import { ParsedConfiguration } from './debugConfigurationParser'
import {
  checkExecutableExists,
  validateGhostscriptPath,
  findWindowsGhostscript,
  resolveGhostscriptPath,
  resolveGhostscript,
  normalizePath,
  type GhostscriptResolutionOptions,
  type GhostscriptResolutionResult
} from '../ghostscriptHelper'

export {
  checkExecutableExists,
  validateGhostscriptPath,
  findWindowsGhostscript,
  resolveGhostscriptPath,
  resolveGhostscript,
  normalizePath,
  type GhostscriptResolutionOptions,
  type GhostscriptResolutionResult
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
