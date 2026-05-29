import { PsStrictLexer } from '../parser/postscriptParser';
import { SymbolKind, DocumentSymbol } from 'vscode-languageserver';
import { POSTSCRIPT_SYMBOL_VIEW, POSTSCRIPT_SYMBOL_TYPE_MAP } from './semanticTokenTypes';

export interface TokenInfo {
  type: string;
  image: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface ParseError {
  message: string;
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
  isWarning?: boolean;
}

interface StackElement {
  type: 'array' | 'dictionary' | 'procedure' | 'mark' | 'value';
  token?: TokenInfo;
  symbol?: DocumentSymbol;
  children?: DocumentSymbol[];
}

function createTokenInfo(token: any): TokenInfo {
  return {
    type: token.tokenType.name,
    image: token.image,
    startOffset: token.startOffset,
    endOffset: token.endOffset,
    startLine: token.startLine,
    startColumn: token.startColumn,
    endLine: token.endLine,
    endColumn: token.endColumn
  };
}

function createSymbol(name: string, kind: SymbolKind, startToken: TokenInfo, endToken?: TokenInfo): DocumentSymbol {
  const end = endToken || startToken;
  return {
    name,
    kind,
    range: {
      start: { line: startToken.startLine - 1, character: startToken.startColumn - 1 },
      end: { line: end.endLine - 1, character: end.endColumn }
    },
    selectionRange: {
      start: { line: startToken.startLine - 1, character: startToken.startColumn - 1 },
      end: { line: startToken.endLine - 1, character: startToken.endColumn }
    },
    children: []
  };
}

export interface ParseResult {
  symbols: DocumentSymbol[];
  errors: ParseError[];
}

export class PostScriptSymbolBuilder {
  private tokens: TokenInfo[] = [];
  private rootSymbols: DocumentSymbol[] = [];
  private errors: ParseError[] = [];
  private stack: StackElement[] = [];
  private stringBuffer: { startToken: TokenInfo; parts: string[]; depth: number; tokens: TokenInfo[] } | null = null;
  private containerDepth = -1;

  public buildSymbols(text: string): DocumentSymbol[] {
    const result = this.parse(text);
    return result.symbols;
  }

  public parse(text: string): ParseResult {
    if (!text || text.trim().length === 0) {
      return { symbols: [], errors: [] };
    }
    
    const lexResult = PsStrictLexer.tokenize(text);
    if (lexResult.errors.length > 0) {
      const errors: ParseError[] = lexResult.errors.map(err => ({
        message: err.message || 'Lexical error',
        line: (err as any).line ?? (err as any).token?.startLine ?? 0,
        column: (err as any).column ?? (err as any).token?.startColumn ?? 0,
        startOffset: (err as any).offset ?? (err as any).token?.startOffset ?? 0,
        endOffset: ((err as any).offset ?? (err as any).token?.startOffset ?? 0) + 1
      }));
      return { symbols: [], errors };
    }

    return this.parseFromTokens(lexResult.tokens, text);
  }

  public parseFromTokens(tokens: any[], text: string): ParseResult {
    this.tokens = tokens.map(createTokenInfo);
    this.rootSymbols = [];
    this.errors = [];

    this.stack = [];
    this.stringBuffer = null;

    for (const token of this.tokens) {
      this.processToken(token);
    }

    this.finalizeStack();

    return { symbols: this.rootSymbols, errors: this.errors };
  }

  private processToken(token: TokenInfo): void {
    if (this.stringBuffer !== null) {
      this.continueStringLiteral(token);
      return;
    }

    switch (token.type) {
      case 'ProcedureStart':
        this.containerDepth++;
        this.stack.push({ type: 'procedure', token, children: [] });
        break;

      case 'ProcedureEnd':
        this.containerDepth--;
        this.handleProcedureEnd(token);
        break;

      case 'ArrayStart': {
        this.containerDepth++;
        this.stack.push({ type: 'array', token, children: [] });
        break;
      }

      case 'ArrayEnd': {
        this.containerDepth--;
        this.handleContainerEnd(token, 'array');
        break;
      }

      case 'DictStart': {
        this.containerDepth++;
        this.stack.push({ type: 'dictionary', token, children: [] });
        break;
      }

      case 'DictEnd': {
        this.containerDepth--;
        this.handleContainerEnd(token, 'dictionary');
        break;
      }

      case 'Mark': {
        this.containerDepth++;
        this.stack.push({ type: 'mark', token });
        break;
      }

      case 'StringLs':
        this.startStringLiteral(token);
        break;

      case 'StringAscii85':
      case 'StringHex':
        this.addValueSymbol(token);
        break;

      default:
        this.addValueSymbol(token);
        break;
    }
  }

  private startStringLiteral(token: TokenInfo): void {
    this.stringBuffer = {
      startToken: token,
      parts: ['('],
      depth: 1,
      tokens: [token]
    };
  }

  private continueStringLiteral(token: TokenInfo): void {
    if (!this.stringBuffer) return;

    if (token.type === 'StringRs') {
      this.stringBuffer.depth--;
      this.stringBuffer.parts.push(')');
      this.stringBuffer.tokens.push(token);
      
      if (this.stringBuffer.depth === 0) {
        const stringContent = this.stringBuffer.parts.join('');
        const symbol = createSymbol(
          stringContent,
          (POSTSCRIPT_SYMBOL_TYPE_MAP['string'] as SymbolKind) || SymbolKind.String,
          this.stringBuffer.startToken,
          token
        );
        this.stack.push({ type: 'value', symbol });
        this.stringBuffer = null;
      }
    } else if (token.type === 'StringLs') {
      this.stringBuffer.depth++;
      this.stringBuffer.parts.push('(');
      this.stringBuffer.tokens.push(token);
    } else if (token.type === 'StringSkip') {
      this.stringBuffer.parts.push(token.image);
      this.stringBuffer.tokens.push(token);
    } else if (token.type === 'Strings') {
      this.stringBuffer.parts.push(token.image);
      this.stringBuffer.tokens.push(token);
    } else {
      this.stringBuffer.parts.push(token.image);
      this.stringBuffer.tokens.push(token);
    }
  }

  private handleProcedureEnd(token: TokenInfo): void {
    const collected: StackElement[] = [];
    
    while (this.stack.length > 0) {
      const top = this.stack.pop()!;
      
      if (top.type === 'procedure') {
        const procedure = createSymbol(
          POSTSCRIPT_SYMBOL_VIEW['procedure'] || 'procedure',
          (POSTSCRIPT_SYMBOL_TYPE_MAP['procedure'] as SymbolKind) || SymbolKind.Function,
          top.token!,
          token
        );
        
        const children: DocumentSymbol[] = [];
        for (let i = collected.length - 1; i >= 0; i--) {
          const elem = collected[i];
          if (elem.symbol) {
            children.push(elem.symbol);
          } else if (elem.token) {
            children.push(this.createLeafSymbol(elem.token));
          }
        }
        procedure.children = children.length > 0 ? children : undefined;
        
        this.stack.push({ type: 'value', symbol: procedure });
        return;
      }
      
      if (top.type === 'array' || top.type === 'dictionary') {
        this.errors.push({
          message: `Unclosed ${top.type} inside procedure at line ${top.token?.startLine}, column ${top.token?.startColumn}`,
          line: top.token?.startLine || 0,
          column: top.token?.startColumn || 0,
          startOffset: top.token?.startOffset || 0,
          endOffset: top.token?.endOffset || 0,
          isWarning: true
        });
      } else if (top.type === 'mark') {
        this.errors.push({
          message: `Orphan mark operator inside procedure at line ${top.token?.startLine}, column ${top.token?.startColumn}`,
          line: top.token?.startLine || 0,
          column: top.token?.startColumn || 0,
          startOffset: top.token?.startOffset || 0,
          endOffset: top.token?.endOffset || 0,
          isWarning: true
        });
      }
      
      collected.push(top);
    }
    
    this.errors.push({
      message: `Mismatched procedure end token '}' at line ${token.startLine}, column ${token.startColumn}. No matching '{' found.`,
      line: token.startLine,
      column: token.startColumn,
      startOffset: token.startOffset,
      endOffset: token.endOffset
    });
  }

  private handleContainerEnd(token: TokenInfo, containerType: 'array' | 'dictionary') {
    const collected: StackElement[] = [];
    let foundStart = false;
    let startToken: TokenInfo | undefined;
    let startType: 'array' | 'dictionary' | 'mark' | undefined;
    
    while (this.stack.length > 0) {
      const top = this.stack.pop()!;
      
      if (top.type === 'array' || top.type === 'dictionary' || top.type === 'mark') {
        foundStart = true;
        startToken = top.token;
        startType = top.type;
        break;
      }
      
      if (top.type === 'procedure') {
        this.stack.push(top);
        break;
      }
      
      collected.push(top);
    }
    
    if (foundStart && startToken && startType) {
      const isArrayEnd = containerType === 'array';
      const actualContainerType = this.getContainerType(startType, isArrayEnd);
      
      const container = createSymbol(
        POSTSCRIPT_SYMBOL_VIEW[actualContainerType] || actualContainerType,
        (POSTSCRIPT_SYMBOL_TYPE_MAP[actualContainerType] as SymbolKind) || 
          (isArrayEnd ? SymbolKind.Array : SymbolKind.Object),
        startToken,
        token
      );
      
      const children: DocumentSymbol[] = [];
      for (let i = collected.length - 1; i >= 0; i--) {
        const elem = collected[i];
        if (elem.symbol) {
          children.push(elem.symbol);
        } else if (elem.token) {
          children.push(this.createLeafSymbol(elem.token));
        }
      }
      container.children = children.length > 0 ? children : undefined;
      
      this.stack.push({ type: 'value', symbol: container });
    } else {
      const isInsideProcedure = this.stack.some(e => e.type === 'procedure');
      
      if (!isInsideProcedure) {
        this.errors.push({
          message: `Mismatched ${containerType} end token '${token.image}' at line ${token.startLine}, column ${token.startColumn}`,
          line: token.startLine,
          column: token.startColumn,
          startOffset: token.startOffset,
          endOffset: token.endOffset,
          isWarning: true
        });
      }
      if (isInsideProcedure) {
        this.errors.push({
          message: `Unbalanced ${containerType} end token '${token.image}' inside procedure at line ${token.startLine}, column ${token.startColumn}`,
          line: token.startLine,
          column: token.startColumn,
          startOffset: token.startOffset,
          endOffset: token.endOffset,
          isWarning: true
        });
        const symbol = this.createLeafSymbol(token);
        this.stack.push({ type: 'value', token, symbol });
      }
    }
  }

  private getContainerType(startType: 'array' | 'dictionary' | 'mark', isArrayEnd: boolean): string {
    if (startType === 'mark') {
      return isArrayEnd ? 'markedArray' : 'markedDictionary';
    }
    if (startType === 'array' && !isArrayEnd) {
      return 'markedDictionary';
    }
    if (startType === 'dictionary' && isArrayEnd) {
      return 'markedArray';
    }
    return isArrayEnd ? 'array' : 'dictionary';
  }

  private addValueSymbol(token: TokenInfo): void {
    const symbol = this.createLeafSymbol(token);
    this.stack.push({ type: 'value', symbol });
  }

  private createLeafSymbol(token: TokenInfo): DocumentSymbol {
    const kind = (POSTSCRIPT_SYMBOL_TYPE_MAP[token.type] as SymbolKind) || SymbolKind.String;
    return createSymbol(token.image, kind, token);
  }

  private finalizeStack(): void {
    if (this.stringBuffer !== null) {
      this.errors.push({
        message: 'Unclosed string literal',
        line: this.stringBuffer.startToken.startLine,
        column: this.stringBuffer.startToken.startColumn,
        startOffset: this.stringBuffer.startToken.startOffset,
        endOffset: this.stringBuffer.startToken.endOffset
      });
      const stringContent = this.stringBuffer.parts.join('');
      const symbol = createSymbol(
        stringContent,
        (POSTSCRIPT_SYMBOL_TYPE_MAP['string'] as SymbolKind) || SymbolKind.String,
        this.stringBuffer.startToken
      );
      this.stack.push({ type: 'value', symbol });
    }

    const result: DocumentSymbol[] = [];
    
    const hasUnclosedProcedure = this.stack.some(e => e.type === 'procedure');
    
    for (const element of this.stack) {
      if (element.type === 'procedure') {
        this.errors.push({
          message: 'Unclosed procedure',
          line: element.token?.startLine || 0,
          column: element.token?.startColumn || 0,
          startOffset: element.token?.startOffset || 0,
          endOffset: element.token?.endOffset || 0
        });
        result.push(this.createLeafSymbol(element.token!));
      } else if (element.type === 'array' || element.type === 'dictionary') {
        if (!hasUnclosedProcedure) {
          this.errors.push({
            message: `Unclosed ${element.type} at line ${element.token?.startLine}, column ${element.token?.startColumn}`,
            line: element.token?.startLine || 0,
            column: element.token?.startColumn || 0,
            startOffset: element.token?.startOffset || 0,
            endOffset: element.token?.endOffset || 0,
            isWarning: true
          });
        } else {
          this.errors.push({
            message: `Unclosed ${element.type} inside procedure at line ${element.token?.startLine}, column ${element.token?.startColumn}`,
            line: element.token?.startLine || 0,
            column: element.token?.startColumn || 0,
            startOffset: element.token?.startOffset || 0,
            endOffset: element.token?.endOffset || 0,
            isWarning: true
          });
        }
        result.push(this.createLeafSymbol(element.token!));
      } else if (element.type === 'mark') {
        if (!hasUnclosedProcedure) {
          this.errors.push({
            message: `Orphan mark operator at line ${element.token?.startLine}, column ${element.token?.startColumn}`,
            line: element.token?.startLine || 0,
            column: element.token?.startColumn || 0,
            startOffset: element.token?.startOffset || 0,
            endOffset: element.token?.endOffset || 0,
            isWarning: true
          });
        } else {
          this.errors.push({
            message: `Orphan mark operator inside procedure at line ${element.token?.startLine}, column ${element.token?.startColumn}`,
            line: element.token?.startLine || 0,
            column: element.token?.startColumn || 0,
            startOffset: element.token?.startOffset || 0,
            endOffset: element.token?.endOffset || 0,
            isWarning: true
          });
        }
        result.push(this.createLeafSymbol(element.token!));
      } else if (element.symbol) {
        result.push(element.symbol);
      } else if (element.token) {
        result.push(this.createLeafSymbol(element.token));
      }
    }
    
    this.rootSymbols = result;
  }
}

export function buildPostScriptSymbols(text: string): DocumentSymbol[] {
  const builder = new PostScriptSymbolBuilder();
  return builder.buildSymbols(text);
}

export function parsePostScript(text: string): ParseResult {
  const builder = new PostScriptSymbolBuilder();
  return builder.parse(text);
}