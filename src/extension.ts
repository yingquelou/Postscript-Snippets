import * as vscode from 'vscode'
let gs: vscode.Terminal
let out: vscode.OutputChannel
export function activate(context: vscode.ExtensionContext) {
    out = vscode.window.createOutputChannel("postscript")
    gs = vscode.window.createTerminal("postscript")
    let hover = vscode.languages.registerHoverProvider('postscript', new PostScriptHoverProvider)
    context.subscriptions.push(hover)
}
export function deactivate() {
    // nothing to do
    out.dispose()
    gs.dispose()
}
class PostScriptHoverProvider implements vscode.HoverProvider {
    static PName = /\/[^\s()\t\r\n\(\)\[\]<>/\/]+/
    static PNumber = /[-+]?\d+/

    provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Hover> {
        let buffer: string[] = []
        let tokenstring = document.getWordRangeAtPosition(position, PostScriptHoverProvider.PName);
        if (tokenstring?.isEmpty === false) {
            buffer.push("**Name**")
            buffer.push(document.getText(tokenstring))
        }
        tokenstring = document.getWordRangeAtPosition(position, PostScriptHoverProvider.PNumber);
        if (tokenstring?.isEmpty === false) {
            buffer.push("**Integer**")
            buffer.push(document.getText(tokenstring))
        }
        return {
            contents: buffer
        }
    }
}