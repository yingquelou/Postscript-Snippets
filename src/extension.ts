import * as vscode from 'vscode'
import { createLanguageClient, LANGUAGE_ID } from './language-server/languageServerClient'
import { createPostscriptDebugConfigurationProvider } from './debugger/debugConfigurationProvider'
import { compilePostscript, setupConfigWatcher, disposeConfigWatcher } from './compilePostscript'

export function activate(context: vscode.ExtensionContext) {
  const client = createLanguageClient(context)
  context.subscriptions.push({ dispose() { client.stop() } })

  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider(
      LANGUAGE_ID,
      createPostscriptDebugConfigurationProvider()
    )
  )
  
  context.subscriptions.push(
    vscode.commands.registerCommand('postscriptsnippets.compilePostscript', compilePostscript)
  )

  setupConfigWatcher()
  context.subscriptions.push({ dispose() { disposeConfigWatcher() } })
}

export function deactivate() {
  disposeConfigWatcher()
}
