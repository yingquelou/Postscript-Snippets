import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeResult,
  Diagnostic,
  DiagnosticSeverity,
  DocumentSymbol,
  SymbolKind
} from 'vscode-languageserver/node'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { psParserHelper, PsParser } from './postscriptParser'
import * as chevrotain from 'chevrotain'

const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)

function setupConnection(connection: any) {
  connection.onInitialize((): InitializeResult => {
    return {
      capabilities: {
        textDocumentSync: 1,
        documentSymbolProvider: true
      }
    }
  })

  documents.onDidChangeContent(change => {
    validateTextDocument(change.document)
  })

  // Track whether a document previously had parse errors to avoid spamming notifications
  const hadParseError: Map<string, boolean> = new Map()
  async function validateTextDocument(textDocument: TextDocument) {
    const text = textDocument.getText()
    const res: any = psParserHelper(text)
    const diagnostics: Diagnostic[] = []
    if (res && res.errors && res.errors.length) {
      for (const err of res.errors) {
        let startOffset = 0
        let endOffset = 1
        if (err.token && typeof err.token.startOffset === 'number') {
          startOffset = err.token.startOffset
          endOffset = typeof err.token.endOffset === 'number' ? err.token.endOffset : startOffset + 1
        }
        const range = { start: textDocument.positionAt(startOffset), end: textDocument.positionAt(endOffset) }
        diagnostics.push({ severity: DiagnosticSeverity.Error, range, message: err.message || JSON.stringify(err), source: 'postscript' })
      }
    }
    const hasError = diagnostics.length > 0
    const prev = hadParseError.get(textDocument.uri) || false
    if (hasError && !prev) {
      try {
        connection.window.showErrorMessage(`PostScript: parse errors - ${diagnostics.length} found; see Problems panel.`)
      } catch (e) { }
      hadParseError.set(textDocument.uri, true)
    } else if (!hasError && prev) {
      try {
        connection.window.showInformationMessage('PostScript: parse issues resolved')
      } catch (e) { }
      hadParseError.set(textDocument.uri, false)
    }
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics })
  }

  connection.onDocumentSymbol((params: any) => {
    const doc = documents.get(params.textDocument.uri)
    if (!doc) return []
    const text = doc.getText()
    const { errors, cst } = psParserHelper(text)
    if (errors && errors.length) return []

    const pstypeMap: Record<string, SymbolKind> = {
      array: SymbolKind.Array,
      dictionary: SymbolKind.Object,
      string: SymbolKind.String,
      Number: SymbolKind.Number,
      LiteralName: SymbolKind.Key,
      ExecutableName: SymbolKind.Function,
      procedure: SymbolKind.Array
    }
    const view: Record<string, string> = {
      array: '[...]',
      dictionary: '<<...>>',
      string: '(...)',
      procedure: '{...}'
    }

    const symbols: DocumentSymbol[] = []

    const VisitorCtor = PsParser.getBaseCstVisitorConstructorWithDefaults<DocumentSymbol[]>()
    class PSSP extends VisitorCtor {
      private document: TextDocument
      constructor(document: TextDocument) {
        super()
        this.document = document
      }
      expression(ctx: chevrotain.CstNode, ss: DocumentSymbol[]) {
        for (const key in ctx) {
          const token: any = (ctx as any)[key][0]
          let location: any
          let rangeStartLine = 0
          let rangeStartCol = 0
          let rangeEndLine = 0
          let rangeEndCol = 0
          switch (key) {
            case 'array':
            case 'dictionary':
            case 'procedure':
            case 'string':
              location = token.location as chevrotain.CstNodeLocation
              rangeStartLine = (location.startLine || 1) - 1
              rangeStartCol = (location.startColumn || 1) - 1
              rangeEndLine = (location.endLine || 1) - 1
              rangeEndCol = location.endColumn || rangeStartCol
              const range = { start: { line: rangeStartLine, character: rangeStartCol }, end: { line: rangeEndLine, character: rangeEndCol } }
              const name = key === 'string' ? this.document.getText(range as any) : view[key]
              const sym: DocumentSymbol = { name, kind: pstypeMap[key], range, selectionRange: range, children: [] }
              ss.push(sym)
              if (token.children && token.children.expression && key !== 'string') {
                this.visit(token, sym.children)
              }
              break
            default:
              // token may be a token object with location info
              location = token as any
              if (location.location) location = location.location
              rangeStartLine = (location.startLine || 1) - 1
              rangeStartCol = (location.startColumn || 1) - 1
              rangeEndLine = (location.endLine || 1) - 1
              rangeEndCol = location.endColumn || rangeStartCol
              const r = { start: { line: rangeStartLine, character: rangeStartCol }, end: { line: rangeEndLine, character: rangeEndCol } }
              const label = token.image || key
              ss.push({ name: label, kind: pstypeMap[key] || SymbolKind.String, range: r, selectionRange: r, children: [] })
          }
        }
      }
    }

    const visitor = new PSSP(doc)
    try { if ((visitor as any).validateVisitor) (visitor as any).validateVisitor() } catch (e) { }
    if (cst) visitor.visit(cst, symbols)
    return symbols
  })

  documents.listen(connection)
}

export function startServer(reader?: any, writer?: any) {
  let connection: any
  if (reader && writer) {
    connection = createConnection(reader, writer)
  } else {
    connection = createConnection(ProposedFeatures.all)
  }
  setupConnection(connection)
  connection.listen()
  return connection
}