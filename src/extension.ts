import * as vscode from 'vscode'
import { createLanguageClient, LANGUAGE_ID } from './language-server/languageServerClient'
import { createPostscriptDebugConfigurationProvider } from './debugger/debugConfigurationProvider'
import { compilePostscript } from './compilePostscript'
import { registerValidateWithGhostscript } from './validateWithGhostscript'
import { createBuildTraceRunner } from './buildTrace'

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('PostScript')
  context.subscriptions.push(outputChannel)

  const client = createLanguageClient(context, outputChannel)
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

  // L3: dynamic validation — gs is the final semantic arbiter. The verdict is
  // pushed back to the language server so structural warnings can be downgraded
  // for exactly the version gs has seen.
  registerValidateWithGhostscript(context, outputChannel, (method, params) => {
    void client.sendNotification(method, params as any)
  })

  // build trace: derive the project model from a real build
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'postscriptsnippets.generateBuildTrace',
      createBuildTraceRunner(context, outputChannel)
    )
  )
}

export function deactivate() {
}
