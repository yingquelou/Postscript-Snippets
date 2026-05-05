import * as vscode from 'vscode'
import { DebugConfiguration, DebugConfigurationProvider } from 'vscode'
import { DebugConfigurationParser } from './debugConfigurationParser'
import { resolveGhostscriptPath } from './debugHelper'

export const createPostscriptDebugConfigurationProvider = (): DebugConfigurationProvider => {
  return {
    provideDebugConfigurations(_folder, _token) {
      const defaultGsPath = resolveGhostscriptPath()
      return [
        {
          type: 'postscript',
          request: 'launch',
          name: 'Launch PostScript',
          program: '${file}',
          args: [],
          cwd: '${workspaceFolder}',
          ghostscriptPath: defaultGsPath || 'gs',
        }
      ]
    },

    resolveDebugConfiguration(folder, config: DebugConfiguration, _token) {
      const workspaceFolder = folder?.uri.fsPath
      const parser = new DebugConfigurationParser(workspaceFolder)
      
      if (!config.type) {
        config.type = 'postscript'
      }
      if (!config.request) {
        config.request = 'launch'
      }
      // 当用户未提供launch.json直接启动时，自动设置默认程序路径
      if (!config.program) {
        config.program = '${file}'
      }
      if (!config.cwd) {
        config.cwd = '${workspaceFolder}'
      }
      
      // 仅执行结构验证，不验证路径存在性 - VSCode 尚未扩展变量
      const result = parser.parseStructural({
        program: config.program as string | undefined,
        ghostscriptPath: config.ghostscriptPath as string | undefined,
        cwd: config.cwd as string | undefined,
        args: config.args as string[] | undefined,
        stopOnEntry: config.stopOnEntry as boolean | undefined
      })

      if (!result.success) {
        const errorMessages = result.errors!.map(e => `${e.message}\n  Suggestion: ${e.suggestion}`).join('\n\n')
        vscode.window.showErrorMessage(`Debug configuration errors:\n\n${errorMessages}`)
        return undefined
      }

      // 填充默认值，保留变量原样由 VSCode 处理扩展
      if (result.config) {
        config.program = result.config.program
        config.ghostscriptPath = result.config.ghostscriptPath
        config.cwd = result.config.cwd
        config.args = result.config.args
        config.stopOnEntry = result.config.stopOnEntry
      }

      return config
    },
  }
}