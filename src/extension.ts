import * as vscode from 'vscode'
import { createLanguageClient, LANGUAGE_ID } from './language-server/languageServerClient'
import { createPostscriptDebugConfigurationProvider } from './debugger/debugConfigurationProvider'

export function activate(context: vscode.ExtensionContext) {
  const client = createLanguageClient()
  context.subscriptions.push(client)

  const debugProvider = createPostscriptDebugConfigurationProvider()
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider(LANGUAGE_ID, debugProvider)
  )
}

export function deactivate() {
  // nothing to do
}