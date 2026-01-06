import { createToken, Lexer, CstParser, IToken, CstNode } from 'chevrotain';

// 定义词法规则
const Comment = createToken({
    name: 'Comment',
    pattern: /%[^\r\n]*/,
    group: Lexer.SKIPPED,
});

const Whitespace = createToken({
    name: 'Whitespace',
    pattern: /\s+/,
    group: Lexer.SKIPPED,
});

const DictionaryStart = createToken({
    name: 'DictionaryStart',
    pattern: /<</,
});

const DictionaryEnd = createToken({
    name: 'DictionaryEnd',
    pattern: />>/,
});

const ArrayStart = createToken({
    name: 'ArrayStart',
    pattern: /\[/,
});

const ArrayEnd = createToken({
    name: 'ArrayEnd',
    pattern: /\]/,
});

const ProcedureStart = createToken({
    name: 'ProcedureStart',
    pattern: /\{/,
});

const ProcedureEnd = createToken({
    name: 'ProcedureEnd',
    pattern: /\}/,
});

const LiteralName = createToken({
    name: 'LiteralName',
    pattern: /\/(?:[^\s\[\]{}<>\/%()]+|\/\/[^\s\[\]{}<>\/%()]*)/,
});

const ExecutableName = createToken({
    name: 'ExecutableName',
    pattern: /(?:[^\s\[\]{}<>\/%()#0-9][^\s\[\]{}<>\/%()]*|\/\/[^\s\[\]{}<>\/%()]*)/,
});

// PostScript 字符串字面量: (string) 可以包含转义的括号和跨行
// 使用一个简化的模式，匹配从 ( 到 ) 的内容，处理转义
const StringLiteral = createToken({
    name: 'StringLiteral',
    pattern: /\([^()]*(?:\([^()]*(?:\([^()]*(?:\([^()]*\)[^()]*)*\)[^()]*)*\)[^()]*)*\)|\([^)]*\)/,
});

const StringHex = createToken({
    name: 'StringHex',
    pattern: /<[0-9A-Fa-f\s]+>/,
});

const StringAscii85 = createToken({
    name: 'StringAscii85',
    pattern: /<~[!-u\s]*~>/,
});

const Number = createToken({
    name: 'Number',
    // 匹配 PostScript 数字格式（按优先级顺序）：
    // 1. 基数数字: base#number (base 2-36), 例如: 8#1777, 16#FFFE, 2#1000
    // 2. 实数（带指数）: 整数+指数, 例如: 1E6, 123e10, -1E-5
    // 3. 实数（带小数点）: 可选符号 + (数字.数字 或 .数字 或 数字.) + 可选指数
    //    例如: -.002, 34.5, -3.62, 123.6e10, 1.0E-5, -1., 0.0
    // 4. 整数: 可选符号 + 一个或多个数字, 例如: 123, -98, 43445, 0, +17
    pattern: /(?:[2-9]|1[0-9]|2[0-9]|3[0-6])#[0-9A-Za-z]+|[+-]?\d+[eE][+-]?\d+|[+-]?(?:\d+\.\d*|\.\d+|\d+\.)(?:[eE][+-]?\d+)?|[+-]?\d+/,
});

// 定义所有 token（顺序很重要，更具体的在前）
// StringAscii85 必须在 DictionaryStart 之前，因为 <~ 可能被误识别为 <<
// DictionaryStart 必须在 StringHex 之前，因为 << 可能被误识别为 <
const psTokens = [
    Comment,
    Whitespace,
    StringAscii85,
    DictionaryStart,
    DictionaryEnd,
    StringHex,
    ArrayStart,
    ArrayEnd,
    ProcedureStart,
    ProcedureEnd,
    StringLiteral,
    LiteralName,
    Number,
    ExecutableName,
];

// Create a lexical analyzer
const psLexer = new Lexer(psTokens);

// Define parser
class PostScriptParser extends CstParser {
    constructor() {
        super(psTokens, { nodeLocationTracking: 'full' });
        this.performSelfAnalysis();
    }

    public program = this.RULE('program', () => {
        this.MANY(() => {
            this.SUBRULE(this.expression);
        });
    });

    public expression = this.RULE('expression', () => {
        this.OR([
            { ALT: () => this.SUBRULE(this.dictionary) },
            { ALT: () => this.SUBRULE(this.array) },
            { ALT: () => this.SUBRULE(this.procedure) },
            { ALT: () => this.CONSUME(StringLiteral) },
            { ALT: () => this.CONSUME(StringHex) },
            { ALT: () => this.CONSUME(StringAscii85) },
            { ALT: () => this.CONSUME(Number) },
            { ALT: () => this.CONSUME(LiteralName) },
            { ALT: () => this.CONSUME(ExecutableName) },
        ]);
    });

    public dictionary = this.RULE('dictionary', () => {
        this.CONSUME(DictionaryStart);
        this.MANY(() => {
            this.SUBRULE(this.expression);
        });
        this.CONSUME(DictionaryEnd);
    });

    public array = this.RULE('array', () => {
        this.CONSUME(ArrayStart);
        this.MANY(() => {
            this.SUBRULE(this.expression);
        });
        this.CONSUME(ArrayEnd);
    });

    public procedure = this.RULE('procedure', () => {
        this.CONSUME(ProcedureStart);
        this.MANY(() => {
            this.SUBRULE(this.expression);
        });
        this.CONSUME(ProcedureEnd);
    });
}

// Create a parser instance
const psParser = new PostScriptParser();

export function psParserHelper(text: string) {
    const lexResult = psLexer.tokenize(text);
    if (lexResult.errors.length > 0) {
        return { errors: lexResult.errors };
    }
    psParser.input = lexResult.tokens;
    const cst = psParser.program();
    const errors = psParser.errors;
    return { errors, cst, tokens: lexResult.tokens };
}

export { PostScriptParser, psTokens, psParser };
export type { IToken };
