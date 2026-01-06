import { psParserHelper, psParser } from './postscriptParser';
import * as vscode from 'vscode'
const pstypeMap = {
    array: vscode.SymbolKind.Array,
    dictionary: vscode.SymbolKind.Object,
    StringLiteral: vscode.SymbolKind.String,
    StringHex: vscode.SymbolKind.String,
    StringAscii85: vscode.SymbolKind.String,
    Number: vscode.SymbolKind.Number,
    LiteralName: vscode.SymbolKind.Key,
    ExecutableName: vscode.SymbolKind.Function,
    procedure: vscode.SymbolKind.Array
}
const view = {
    array: '[...]',
    dictionary: '<<...>>',
    procedure: '{...}'
}
class pssp extends psParser.getBaseCstVisitorConstructorWithDefaults<vscode.SymbolInformation[]>() {
    private readonly document: vscode.TextDocument
    constructor(document: vscode.TextDocument) {
        super()
        this.document = document
    }
    expression(ctx: any, ss: vscode.SymbolInformation[], ...args: any[]) {
        for (const key in ctx) {
            const token = ctx[key][0]
            switch (key) {
                case 'array':
                case 'dictionary':
                case 'procedure':
                    const location = token.location
                    ss.push({
                        name: view[key],
                        containerName: '', kind: pstypeMap[key],
                        location: new vscode.Location(this.document.uri,
                            new vscode.Range(
                                this.document.positionAt(location.startOffset),
                                this.document.positionAt(location.endOffset + 1)))
                    })
                    if (token.children.expression)
                        this.visit(token, ss)
                    break;
                default:
                    ss.push({
                        name: token.image, containerName: '',
                        kind: pstypeMap[key],
                        location: new vscode.Location(this.document.uri,
                            new vscode.Range(
                                this.document.positionAt(token.startOffset),
                                this.document.positionAt(token.endOffset + 1)))
                    })
            }
        }
    }
}
export class PostScriptDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    async provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken) {
        const ss: vscode.SymbolInformation[] = []
        const { errors, cst } = psParserHelper(document.getText())
        if (errors.length > 0) return []
        const visitor = new pssp(document)
        if (cst) visitor.visit(cst, ss)
        return ss
    }
}