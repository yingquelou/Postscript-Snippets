import * as vscode from 'vscode'
export function activate(context: vscode.ExtensionContext) {
    let demo_dis = vscode.commands.registerCommand("postscript.demo", () => {
        let s = vscode.workspace.name
        if (s !== undefined)
            vscode.window.showInformationMessage(s)
    })
    // let cm = vscode.window.createOutputChannel("postscript", "postscript")
    // let tokenTypes=["fd"]
    // let tokenModifiers=["fd"]
    let hover = vscode.languages.registerHoverProvider('postscript', new PostScriptHoverProvider)
    context.subscriptions.push(demo_dis)
    context.subscriptions.push(hover)
    // vscode.languages.registerDocumentSemanticTokensProvider("postscript",new PostScriptDocumentSemanticTokensProvider,{
    //     tokenTypes,
    //     tokenModifiers
    // })
}
export function deactivate() {
    // nothing to do
}
class PostScriptHoverProvider implements vscode.HoverProvider {
    static PName = /\/[^ ()\/]+/
    static PNumber = /\d+/

    provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Hover> {
        let buffer: string[] = []
        // cm.appendLine(JSON.stringify(document.offsetAt(position)))
        // cm.appendLine(document.getText(document.getWordRangeAtPosition(position,PName)))
        let tokenstring = document.getWordRangeAtPosition(position, PostScriptHoverProvider.PName);
        if (tokenstring?.isEmpty === false) {
            buffer.push("**Name**")
            buffer.push(document.getText(tokenstring))
        }
        return {
            contents: buffer
        }
    }
}
// class PostScriptDocumentSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
//     onDidChangeSemanticTokens?: vscode.Event<void> | undefined
//     provideDocumentSemanticTokens(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.SemanticTokens> {
//         throw new Error('Method not implemented.')
//     }
//     provideDocumentSemanticTokensEdits?(document: vscode.TextDocument, previousResultId: string, token: vscode.CancellationToken): vscode.ProviderResult<vscode.SemanticTokens | vscode.SemanticTokensEdits> {
//         throw new Error('Method not implemented.')
//     }
// }
