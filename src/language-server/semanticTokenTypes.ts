import { SymbolKind } from 'vscode-languageserver';

export const POSTSCRIPT_SYMBOL_VIEW: { [key: string]: string } = {
  array: '[...]',
  dictionary: '<<...>>',
  string: '(...)',
  procedure: '{...}',
  markedArray: '[...]',
  markedDictionary: '<<...>>'
};

export const POSTSCRIPT_SYMBOL_TYPE_MAP: { [key: string]: SymbolKind } = {
  array: SymbolKind.Array,
  dictionary: SymbolKind.Object,
  string: SymbolKind.String,
  Number: SymbolKind.Number,
  LiteralName: SymbolKind.Variable,
  ExecutableName: SymbolKind.Method,
  Mark: SymbolKind.Operator,
  ArrayStart: SymbolKind.Operator,
  ArrayEnd: SymbolKind.Operator,
  DictStart: SymbolKind.Operator,
  DictEnd: SymbolKind.Operator,
  procedure: SymbolKind.Function,
  markedArray: SymbolKind.Array,
  markedDictionary: SymbolKind.Object,
  StringAscii85: SymbolKind.String,
  StringHex: SymbolKind.String,
  StringLs: SymbolKind.String,
  StringRs: SymbolKind.String,
  Strings: SymbolKind.String,
  StringSkip: SymbolKind.String,
  ProcedureStart: SymbolKind.Function,
  ProcedureEnd: SymbolKind.Function
};
