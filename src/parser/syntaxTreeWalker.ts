import * as chevrotain from 'chevrotain';
import { extractTokenPositions, TokenPosition } from './tokenLocator';

export interface CstWalkerState {
    index: number;
}

export class CstWalker {
    private tokens: TokenPosition[];
    private currentIndex: number;
    private programText: string;

    constructor(cst: chevrotain.CstNode, programText: string) {
        this.programText = programText ?? '';
        this.tokens = extractTokenPositions(cst) ?? [];
        this.currentIndex = 0;
    }

    getCurrentNodeText(): string {
        if (this.currentIndex < this.tokens.length) {
            const token = this.tokens[this.currentIndex];
            return this.programText.substring(token.startOffset, token.endOffset + 1);
        }
        return '';
    }

    getCurrentLocation(): chevrotain.CstNodeLocation {
        if (this.currentIndex < this.tokens.length) {
            const token = this.tokens[this.currentIndex];
            return {
                startOffset: token.startOffset,
                startLine: token.startLine,
                startColumn: token.startColumn,
                endOffset: token.endOffset,
                endLine: token.endLine,
                endColumn: token.endColumn
            };
        }
        return { startOffset: this.programText.length };
    }

    step(): string {
        if (this.currentIndex < this.tokens.length) {
            const text = this.getCurrentNodeText();
            this.currentIndex++;
            return text;
        }
        return '';
    }

    saveState(): CstWalkerState {
        return { index: this.currentIndex };
    }

    rollback(state: CstWalkerState): void {
        if (state && typeof state.index === 'number') {
            this.currentIndex = Math.max(0, Math.min(state.index, this.tokens.length));
        }
    }
}