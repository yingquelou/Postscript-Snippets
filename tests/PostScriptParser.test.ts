import { PsStrictLexer } from '../out/parser/postscriptParser'
import { buildPostScriptSymbols } from '../out/language-server/symbolBuilder'
import { readFile, writeFileSync } from 'fs'

readFile('ps.test/s.ps', (err, data) => {
    if (err) {
        console.error('Error reading file:', err);
        return;
    }
    
    const text = data.toString()
    const lexResult = PsStrictLexer.tokenize(text)
    writeFileSync('b.json',JSON.stringify(lexResult.tokens, null, 2))
    console.log('Lex errors:', lexResult.errors)
    const symbols = buildPostScriptSymbols(text)
    console.log('Symbols count:', symbols.length)
    
    writeFileSync('a.json', JSON.stringify(symbols, null, 2))
});