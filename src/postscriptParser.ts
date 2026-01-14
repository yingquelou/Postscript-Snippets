import * as chevrotain from 'chevrotain';

// 定义词法规则
const Comment = chevrotain.createToken({
    name: 'Comment',
    pattern: /%[^\r\n]*/,
    group: chevrotain.Lexer.SKIPPED,
});

const Whitespace = chevrotain.createToken({
    name: 'Whitespace',
    pattern: /\s+/,
    group: chevrotain.Lexer.SKIPPED,
});

const ProcedureStart = chevrotain.createToken({
    name: 'ProcedureStart',
    pattern: /\{/,
});

const ProcedureEnd = chevrotain.createToken({
    name: 'ProcedureEnd',
    pattern: /\}/,
});

const LiteralName = chevrotain.createToken({
    name: 'LiteralName',
    pattern: /\/(?:[^\s\[\]{}<>\/%()]*)/,
});

const ExecutableName = chevrotain.createToken({
    name: 'ExecutableName',
    pattern: /(?:\[|>>|<<|\]|[^\s\[\]{}<>\/%()#0-9][^\s\[\]{}<>\/%()]*|\/\/[^\s\[\]{}<>\/%()]*)/,
});

const StringHex = chevrotain.createToken({
    name: 'StringHex',
    pattern: /<[0-9A-Fa-f\s]+>/,
});

const StringAscii85 = chevrotain.createToken({
    name: 'StringAscii85',
    pattern: /<~[!-u\s]*~>/,
});

const Number = chevrotain.createToken({
    name: 'Number',
    // 匹配 PostScript 数字格式（按优先级顺序）：
    // 1. 基数数字: base#number (base 2-36), 例如: 8#1777, 16#FFFE, 2#1000
    // 2. 实数（带指数）: 整数+指数, 例如: 1E6, 123e10, -1E-5
    // 3. 实数（带小数点）: 可选符号 + (数字.数字 或 .数字 或 数字.) + 可选指数
    //    例如: -.002, 34.5, -3.62, 123.6e10, 1.0E-5, -1., 0.0
    // 4. 整数: 可选符号 + 一个或多个数字, 例如: 123, -98, 43445, 0, +17
    pattern: /(?:[2-9]|1[0-9]|2[0-9]|3[0-6])#[0-9A-Za-z]+|[+-]?\d+[eE][+-]?\d+|[+-]?(?:\d+\.\d*|\.\d+|\d+\.)(?:[eE][+-]?\d+)?|[+-]?\d+/,
});

// PostScript 字符串字面量: (string) 可以包含转义的括号和跨行
// 使用一个简化的模式，匹配从 ( 到 ) 的内容，处理转义
const StringLs = chevrotain.createToken({
    name: 'StringLs',
    pattern: /\(/,
    push_mode: 'string'
});
const StringRs = chevrotain.createToken({
    name: 'StringRs',
    pattern: /\)/,
    pop_mode: true
});
const Strings = chevrotain.createToken({
    name: 'Strings',
    pattern: /\\(?:[nrtbf\()]|\d{3}|\r?\n)|.|\r?\n/
});

// 定义所有 token（顺序很重要，更具体的在前）
// StringAscii85 必须在 DictionaryStart 之前，因为 <~ 可能被误识别为 <<
// DictionaryStart 必须在 StringHex 之前，因为 << 可能被误识别为 <
const PsTokens: chevrotain.IMultiModeLexerDefinition = {
    modes: {
        string: [StringLs, StringRs, Strings],
        default: [Comment,
            StringLs,
            Whitespace,
            StringAscii85,
            StringHex,
            ExecutableName,
            ProcedureStart,
            ProcedureEnd,
            LiteralName,
            Number]
    },
    defaultMode: 'default'
};

// Create a lexical analyzer
const PsLexer = new chevrotain.Lexer(PsTokens);

// Define parser
class PostScriptParser extends chevrotain.CstParser {
    constructor() {
        super(PsTokens, { nodeLocationTracking: 'full' });
        this.performSelfAnalysis();
    }

    public program = this.RULE('program', () => {
        this.MANY(() => {
            this.SUBRULE(this.expression);
        });
    });

    public expression = this.RULE('expression', () => {
        this.OR([
            { ALT: () => this.SUBRULE(this.procedure) },
            { ALT: () => this.SUBRULE(this.string) },
            { ALT: () => this.CONSUME(Number) },
            { ALT: () => this.CONSUME(LiteralName) },
            { ALT: () => this.CONSUME(ExecutableName) },
        ]);
    });
    public string = this.RULE('string', () => {
        this.OR([
            { ALT: () => this.CONSUME(StringAscii85) },
            { ALT: () => this.CONSUME(StringHex) },
            { ALT: () => this.SUBRULE(this.stringLiteral) }
        ])
    });
    public stringLiteral = this.RULE('stringLiteral', () => {
        this.CONSUME(StringLs);
        this.MANY(() => {
            this.SUBRULE(this.substringLiteral)
        });
        this.CONSUME(StringRs);
    });
    public substringLiteral = this.RULE('substringLiteral', () => {
        this.OR([
            { ALT: () => this.SUBRULE(this.stringLiteral) },
            { ALT: () => this.CONSUME(Strings) }
        ])
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
const PsParser = new PostScriptParser();

export function psParserHelper(text: string) {
    const lexResult = PsLexer.tokenize(text);
    if (lexResult.errors.length > 0) {
        return { errors: lexResult.errors };
    }
    PsParser.input = lexResult.tokens;
    const cst = PsParser.program();
    const errors = PsParser.errors;
    return { errors, cst, tokens: lexResult.tokens };
}
export { PostScriptParser, PsTokens, PsParser };