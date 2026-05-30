import * as vscode from 'vscode'
import * as path from 'path'
import { LanguageClient, LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node'
import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node'
import { PassThrough } from 'stream'
import { startServer } from './languageServer'

const LANGUAGE_ID = 'postscript'

export function createLanguageClient(context: vscode.ExtensionContext): LanguageClient {
  const clientToServer = new PassThrough()
  const serverToClient = new PassThrough()
  const clientReader = new StreamMessageReader(serverToClient)
  const clientWriter = new StreamMessageWriter(clientToServer)

  const extensionUri = context.extensionUri
  const psScriptsPath = path.join(extensionUri.fsPath, 'ps')
  const snippetsPath = path.join(extensionUri.fsPath, '.snippets')
  
  const serverReader = new StreamMessageReader(clientToServer)
  const serverWriter = new StreamMessageWriter(serverToClient)
  startServer(serverReader, serverWriter, psScriptsPath, snippetsPath)

  // 创建 Output Channel（在 clientOptions 之前创建以便配置）
  const outputChannel = vscode.window.createOutputChannel('PostScript')
  context.subscriptions.push(outputChannel)

  const serverOptions: ServerOptions = () =>
    Promise.resolve({ reader: clientReader, writer: clientWriter })

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: LANGUAGE_ID }],
    synchronize: {
      configurationSection: 'postscript',
      fileEvents: [
        vscode.workspace.createFileSystemWatcher('**/*.{ps,eps}'),
        vscode.workspace.createFileSystemWatcher('postscript.config.json')
      ]
    },
    // 配置输出通道，将服务器 console 消息重定向到统一的输出通道
    outputChannel: outputChannel
  }

  const client = new LanguageClient(
    'postscriptLanguageServer',
    'PostScript Language Server',
    serverOptions,
    clientOptions
  )
  client.start()

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  statusBar.command = 'postscriptsnippets.showPreloadErrors'
  context.subscriptions.push(statusBar)

  const showCmd = vscode.commands.registerCommand('postscriptsnippets.showPreloadErrors', async () => {
    outputChannel.show(true)
  })
  context.subscriptions.push(showCmd)

  const attachNotificationHandler = () => {
    client.onNotification('postscript/preloadDetails', (params: any) => {
      const errors: Array<any> = Array.isArray(params?.errors) ? params.errors : []
      const configUri: string | undefined = params?.configUri
      if (!errors.length) {
        statusBar.hide()
        return
      }

      const count = errors.length
      statusBar.text = `PostScript: ${count} preload error${count > 1 ? 's' : ''}`
      statusBar.tooltip = 'Show PostScript preload errors'
      statusBar.show()

      outputChannel.appendLine(`=== ${new Date().toLocaleString()} Preload errors for ${configUri || 'workspace'} ===`)
      for (const e of errors) {
        outputChannel.appendLine(`${e.level.toUpperCase()} ${e.errorType} ${e.filePath}`)
        outputChannel.appendLine(e.message)
        outputChannel.appendLine('---')
      }
      outputChannel.appendLine('')
    })
  }

  try {
    if (typeof (client as any).onReady === 'function') {
      ;(client as any).onReady().then(attachNotificationHandler)
    } else if ((client as any).onReady && typeof (client as any).onReady.then === 'function') {
      ;(client as any).onReady.then(attachNotificationHandler)
    } else {
      attachNotificationHandler()
    }
  } catch {
    attachNotificationHandler()
  }

  return client
}

export { LANGUAGE_ID }
