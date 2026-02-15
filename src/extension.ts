import * as vscode from 'vscode'
import { DebugConfiguration, DebugConfigurationProvider } from 'vscode'
import { createLanguageClient, LANGUAGE_ID } from './languageServerClient'

export function activate(context: vscode.ExtensionContext) {
  const client = createLanguageClient()
  context.subscriptions.push(client)

  const debugConfigurationProvider: DebugConfigurationProvider = {
    provideDebugConfigurations(_folder, _token) {
      return [
        {
          type: 'postscript',
          request: 'launch',
          name: 'Launch PostScript',
          program: '${file}',
          args: [],
          cwd: '${workspaceFolder}',
          ghostscriptPath: 'gs',
        },
      ]
    },
    resolveDebugConfiguration(_folder, config: DebugConfiguration, _token) {
      if (!config.type) return undefined
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
