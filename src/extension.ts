import * as vscode from 'vscode'
import { DebugConfiguration, DebugConfigurationProvider } from 'vscode'
import { createLanguageClient, LANGUAGE_ID } from './languageServerClient'

export function activate(context: vscode.ExtensionContext) {
  const client = createLanguageClient()
  context.subscriptions.push(client)

  const debugConfigurationProvider: DebugConfigurationProvider = {
    provideDebugConfigurations(_folder, _token) {
      // Get the default Ghostscript path based on platform
      const defaultGsPath = process.platform === 'win32' ? 'gswin64c' : 'gs'
      return [
        {
          type: 'postscript',
          request: 'launch',
          name: 'Launch PostScript',
          program: '${file}',
          args: [],
          cwd: '${workspaceFolder}',
          ghostscriptPath: defaultGsPath,
        },
      ]
    },
    resolveDebugConfiguration(_folder, config: DebugConfiguration, _token) {
      if (!config.type) return undefined

      // If ghostscriptPath is not set in launch.json, read from VS Code settings
      if (!config.ghostscriptPath) {
        const configSettings = vscode.workspace.getConfiguration('postscript.interpreter')
        const settingsPath = configSettings.get<string>('executable')
        if (settingsPath) {
          config.ghostscriptPath = settingsPath
        }
      }

      return config
    },
  }
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider(LANGUAGE_ID, debugConfigurationProvider)
  )
}

export function deactivate() {
  // nothing to do
}
