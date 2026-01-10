import * as vscode from 'vscode'
import { DebugConfiguration, DebugConfigurationProvider } from 'vscode'
import { PostScriptDocumentSymbolProvider } from './postscriptDocumentSymbolProvider'
const languageId = 'postscript'

export function activate(context: vscode.ExtensionContext) {
    let channel = vscode.window.createOutputChannel(languageId)
    function dcrefMessage(message: any) {
        switch (message.type) {
            case 'event':
                channel.appendLine(`event:${message.event}`)
                break;
            case 'response':
                channel.appendLine(`response=>${message.command}`)
                break
            case 'request':
                channel.appendLine(`request<=${message.command}`)
                break
            default:
                channel.appendLine(JSON.stringify(message))

                break;
        }
    }
    const debugConfigurationProvider: DebugConfigurationProvider = {
        provideDebugConfigurations(folder, token) {
            return [
                {
                    type: 'postscript',
                    request: 'launch',
                    name: 'Launch PostScript (Ghostscript)',
                    program: '${file}',
                    ghostscriptPath: 'gswin64c'
                }
            ]
        },
        resolveDebugConfiguration(folder, config: DebugConfiguration, token) {
            if (!config || !config.type) {
                return undefined
            }
            return config
        }
    }

    const documentSymbolProvider = new PostScriptDocumentSymbolProvider()
    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(
            { language: languageId },
            documentSymbolProvider
        )
    )

    context.subscriptions.push(channel,
        vscode.debug.registerDebugConfigurationProvider(languageId, debugConfigurationProvider),
        vscode.debug.onDidReceiveDebugSessionCustomEvent((e) => {
            if (e.session.type === languageId)
                switch (e.event) {
                    case 'channel':
                        channel.appendLine(JSON.stringify(e.body))
                        break;
                    default:
                        break;
                }
        }),
        vscode.debug.registerDebugAdapterTrackerFactory(languageId, {
            createDebugAdapterTracker: function (session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterTracker> {
                return {
                    onDidSendMessage(message) {
                        dcrefMessage(message)
                    }, onWillReceiveMessage(message) {
                        dcrefMessage(message)
                    }
                }
            }
        })
    )
}

export function deactivate() {
    // nothing to do
}