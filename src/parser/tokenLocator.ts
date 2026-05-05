import * as chevrotain from 'chevrotain';
import { PostScriptParser } from './postscriptParser';

export type TokenPosition = {
    startOffset: number;
    startLine: number;
    startColumn: number;
    endOffset: number;
    endLine: number;
    endColumn: number;
};

// Create temporary parser instance to access CST visitor constructor
const tempParser = new PostScriptParser();
const TokenLocatorVisitor = tempParser.getBaseCstVisitorConstructorWithDefaults<TokenPosition[]>();

class TokenLocatorVisitorClass extends TokenLocatorVisitor {
    expression(ctx: any, arr: TokenPosition[]) {
        for (const key in ctx) {
            const node = ctx[key][0];
            if ('location' in node) {
                arr.push(node.location);
            } else {
                arr.push(node);
            }
        }
    }
}

export { TokenLocatorVisitorClass };

export function extractTokenPositions(cst: chevrotain.CstNode): TokenPosition[] {
    const visitor = new TokenLocatorVisitorClass();
    const arr: TokenPosition[] = [];
    visitor.visit(cst, arr);
    return arr;
}