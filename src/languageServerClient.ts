import * as vscode from 'vscode'
import { LanguageClient, LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node'
import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node'
import { PassThrough } from 'stream'
import { startServer } from './server'

const LANGUAGE_ID = 'postscript'

/**
 * Creates and starts the PostScript language server client (in-process, in-memory streams).
 * Caller must add the returned client to context.subscriptions.
 */
export function createLanguageClient(): LanguageClient {
  const clientToServer = new PassThrough()
  const serverToClient = new PassThrough()
  const clientReader = new StreamMessageReader(serverToClient)
  const clientWriter = new StreamMessageWriter(clientToServer)
  const serverReader = new StreamMessageReader(clientToServer)
  const serverWriter = new StreamMessageWriter(serverToClient)

  startServer(serverReader, serverWriter)

  const serverOptions: ServerOptions = () =>
    Promise.resolve({ reader: clientReader, writer: clientWriter })

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: LANGUAGE_ID }],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*'),
    },
  }

  const client = new LanguageClient(
    'postscriptLanguageServer',
    'PostScript Language Server',
    serverOptions,
    clientOptions
  )
  client.start()
  return client
}

export { LANGUAGE_ID }
