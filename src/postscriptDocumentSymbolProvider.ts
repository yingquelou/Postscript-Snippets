import { psParserHelper, psParser } from './postscriptParser';
import * as vscode from 'vscode'
import * as chevrotain from 'chevrotain';
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
class pssp extends psParser.getBaseCstVisitorConstructorWithDefaults<vscode.DocumentSymbol[]>() {
    expression(ctx: chevrotain.CstNode, ss: vscode.DocumentSymbol[]) {
        for (const key in ctx) {
            const token = ctx[key][0]
            var location: chevrotain.CstNodeLocation
            var range: vscode.Range
            switch (key) {
                case 'array':
                case 'dictionary':
                case 'procedure':
                    location = token.location as chevrotain.CstNodeLocation
                    range = new vscode.Range(location.startLine! - 1, location.startColumn! - 1,
                        location.endLine! - 1, location.endColumn!)
                    const symbol = new vscode.DocumentSymbol(view[key], key, pstypeMap[key], range, range);
                    ss.push(symbol)
                    if (token.children.expression)
                        this.visit(token, symbol.children)
                    break;
                default:
                    location = token as chevrotain.CstNodeLocation
                    range = new vscode.Range(location.startLine! - 1, location.startColumn! - 1,
                        location.endLine! - 1, location.endColumn!)
                    ss.push(new vscode.DocumentSymbol(token.image, key, pstypeMap[key], range, range))
            }
        }
    }
}
export class PostScriptDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    async provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken) {
        const ss: vscode.DocumentSymbol[] = []
        if (!token.isCancellationRequested) {
            const { errors, cst } = psParserHelper(document.getText())
            if (errors.length > 0) return []
            const visitor = new pssp(document)
            if (cst) visitor.visit(cst, ss)
        }
        return ss
    }
}