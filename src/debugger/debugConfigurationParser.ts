import * as fs from 'fs'
import * as path from 'path'
import { validateGhostscriptPath, resolveGhostscriptPath } from './debugHelper'

export interface DebugConfiguration {
  program?: string
  ghostscriptPath?: string
  cwd?: string
  args?: string[]
  stopOnEntry?: boolean
}

export interface ParsedConfiguration {
  program: string
  ghostscriptPath: string
  cwd: string
  args: string[]
  stopOnEntry: boolean
}

export interface ValidationError {
  field: string
  message: string
  suggestion: string
}

export interface ParseResult {
  success: boolean
  config?: ParsedConfiguration
  errors?: ValidationError[]
}

const DEFAULT_GS_PATH = 'gs'
const DEFAULT_STOP_ON_ENTRY = false

let vscode: any
try {
  vscode = require('vscode')
} catch {
  vscode = undefined
}

export class DebugConfigurationParser {
  private workspaceFolder?: string

  constructor(workspaceFolder?: string) {
    this.workspaceFolder = workspaceFolder
  }

  /**
   * 结构解析阶段: 仅验证配置结构，填充默认值，不执行文件系统验证
   * 在 VSCode resolveDebugConfiguration 阶段调用，此时变量尚未扩展
   */
  public parseStructural(config: DebugConfiguration): ParseResult {
    const errors: ValidationError[] = []
    const parsed: Partial<ParsedConfiguration> = {}

    if (!config.program) {
      errors.push({
        field: 'program',
        message: 'Program path is required',
        suggestion: 'Please specify the PostScript file to debug in the "program" field.'
      })
    } else {
      parsed.program = config.program
    }

    let gsPath = config.ghostscriptPath
    if (!gsPath) {
      gsPath = this.getGhostscriptPathFromSettings()
    }
    if (!gsPath) {
      gsPath = resolveGhostscriptPath()
    }
    
    if (!gsPath) {
      errors.push({
        field: 'ghostscriptPath',
        message: 'Ghostscript executable not found',
        suggestion: 'Please install Ghostscript and ensure it is in your PATH, or specify the path in launch.json or VS Code settings.'
      })
    } else {
      parsed.ghostscriptPath = gsPath
    }

    let cwd = config.cwd
    if (!cwd) {
      cwd = this.workspaceFolder
    }
    if (!cwd) {
      cwd = process.cwd()
    }
    parsed.cwd = cwd

    if (config.args !== undefined) {
      if (!Array.isArray(config.args)) {
        errors.push({
          field: 'args',
          message: 'args must be an array of strings',
          suggestion: 'Please ensure args is an array like ["-dSAFER", "-dBATCH"].'
        })
      } else {
        const invalidItems = config.args.filter(arg => typeof arg !== 'string')
        if (invalidItems.length > 0) {
          errors.push({
            field: 'args',
            message: `args contains non-string elements`,
            suggestion: 'Please ensure all items in args are strings.'
          })
        } else {
          parsed.args = config.args.map(v => v.trim()).filter(v => v !== '' && v !== '-')
        }
      }
    } else {
      parsed.args = []
    }

    parsed.stopOnEntry = config.stopOnEntry !== undefined ? config.stopOnEntry : DEFAULT_STOP_ON_ENTRY

    if (errors.length > 0) {
      return { success: false, errors }
    }

    return {
      success: true,
      config: parsed as ParsedConfiguration
    }
  }

  /**
   * 路径验证阶段: 在变量已经被 VSCode 完全扩展后执行
   * 验证路径存在性和正确性
   */
  public validateResolvedPaths(config: ParsedConfiguration): ValidationError[] {
    const errors: ValidationError[] = []

    // 验证 program 文件
    const resolvedProgram = this.resolvePath(config.program)
    if (!fs.existsSync(resolvedProgram)) {
      errors.push({
        field: 'program',
        message: `Program file not found: ${resolvedProgram}`,
        suggestion: 'Please check that the program path is correct and the file exists.'
      })
    } else {
      const stat = fs.statSync(resolvedProgram)
      if (!stat.isFile()) {
        errors.push({
          field: 'program',
          message: `Program path is not a file: ${resolvedProgram}`,
          suggestion: 'Please specify a valid PostScript file path.'
        })
      }
    }

    // 验证 ghostscript 路径
    if (!validateGhostscriptPath(config.ghostscriptPath)) {
      errors.push({
        field: 'ghostscriptPath',
        message: `Invalid Ghostscript path: ${config.ghostscriptPath}`,
        suggestion: 'Please verify the path is correct and points to a valid Ghostscript executable.'
      })
    }

    // 验证 工作目录
    const resolvedCwd = this.resolvePath(config.cwd)
    if (!fs.existsSync(resolvedCwd)) {
      errors.push({
        field: 'cwd',
        message: `Working directory not found: ${resolvedCwd}`,
        suggestion: 'Please check that the working directory path is correct.'
      })
    } else {
      const stat = fs.statSync(resolvedCwd)
      if (!stat.isDirectory()) {
        errors.push({
          field: 'cwd',
          message: `Working directory is not a directory: ${resolvedCwd}`,
          suggestion: 'Please specify a valid directory path.'
        })
      }
    }

    return errors
  }

  private resolvePath(p: string): string {
    if (p.startsWith('file://')) {
      try {
        return path.normalize(decodeURIComponent(p.replace('file://', '')))
      } catch {
        return path.normalize(p.replace('file://', ''))
      }
    }
    if (path.isAbsolute(p)) {
      return path.normalize(p)
    }
    if (this.workspaceFolder) {
      return path.normalize(path.resolve(this.workspaceFolder, p))
    }
    return path.normalize(path.resolve(p))
  }

  /**
   * 保留原 parse 方法用于向后兼容
   * @deprecated 请使用 parseStructural 和 validateResolvedPaths 分阶段调用
   */
  public parse(config: DebugConfiguration): ParseResult {
    const structuralResult = this.parseStructural(config)
    if (!structuralResult.success || !structuralResult.config) {
      return structuralResult
    }

    const pathErrors = this.validateResolvedPaths(structuralResult.config)
    if (pathErrors.length > 0) {
      return { success: false, errors: pathErrors }
    }

    return structuralResult
  }

  private getGhostscriptPathFromSettings(): string | undefined {
    if (!vscode) {
      return undefined
    }
    try {
      const configSettings = vscode.workspace.getConfiguration('postscript.interpreter')
      return configSettings.get('executable') as string | undefined
    } catch {
      return undefined
    }
  }

  public validate(config: DebugConfiguration): ValidationError[] {
    const result = this.parse(config)
    return result.errors || []
  }

  public getDefaultConfiguration(): ParsedConfiguration {
    return {
      program: '',
      ghostscriptPath: DEFAULT_GS_PATH,
      cwd: this.workspaceFolder || process.cwd(),
      args: [],
      stopOnEntry: DEFAULT_STOP_ON_ENTRY
    }
  }
}