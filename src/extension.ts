import * as vscode from 'vscode'
import { DebugConfiguration, DebugConfigurationProvider } from 'vscode'
import { PostScriptDocumentSymbolProvider } from './postscriptDocumentSymbolProvider'
const languageId = 'postscript'

export function activate(context: vscode.ExtensionContext) {
    const debugConfigurationProvider: DebugConfigurationProvider = {
        provideDebugConfigurations(folder, token) {
            return [
                {
                    type: 'postscript',
                    request: 'launch',
                    name: 'Launch PostScript',
                    program: '${file}',
                    args:[],
                    cwd:'${workspaceFolder}',
                    ghostscriptPath: 'gs'
                }
            ]
        },
        resolveDebugConfiguration(folder, config: DebugConfiguration, token) {
            if (!config.type) {
                return undefined
            }
            return config
        }
    }
    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(
            { language: languageId }, new PostScriptDocumentSymbolProvider()),
        vscode.debug.registerDebugConfigurationProvider(languageId, debugConfigurationProvider))
}

export function deactivate() {
    // nothing to do
}