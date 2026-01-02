import * as vscode from 'vscode'
import { DebugConfiguration, DebugConfigurationProvider } from 'vscode'
const languageId = 'postscript'
export function activate(context: vscode.ExtensionContext) {
    let channel = vscode.window.createOutputChannel(languageId)
    // gs = vscode.window.createTerminal("postscript")
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
        }))
}

export function deactivate() {
    // nothing to do
}