import * as fs from 'fs'
import * as marked from 'marked'
import path = require('path')
function createBody(params: string) {
    return params.split(/\s+/).filter(v => v.trim().length).map((v, i) => {
        const s = v.replace('$', '\\$')
        return `\${${i + 1}` + (v.includes(',') ? `|${s}|` : `:${s}`) + '}'
    })
}
/**
 * Parse `MarkDown` files that meet the specified format
 * to generate the PS code snippet files required by the extension.
 * For formatting conventions, please refer to the `operators.md` file.
 */
function snippetsGenerator(markDownPath: string) {
    return new Promise((resolve, reject) => {
        const destDir = path.join(__dirname, '..', 'snippets')
        fs.mkdir(destDir, { recursive: true }, err => {
            if (err) throw err
            fs.readFile(markDownPath, (err, data) => {
                if (err === null) {
                    var snippetFileName: string
                    const desc: { [key: string]: string }[] = []
                    new marked.Lexer().lex(data.toString()).forEach(
                        token => {
                            if (token.type === 'heading') {
                                snippetFileName = path.join(destDir, token.text + '.json')
                            } else if (token.type === 'table') {
                                var snippet_file: number
                                snippet_file = fs.openSync(snippetFileName, 'w')
                                var header = token.header as marked.Tokens.TableCell[]
                                var rows = token.rows as marked.Tokens.TableCell[][]
                                var snippet = {}
                                rows.map(row => {
                                    var obj: { [key: string]: string } = {}
                                    row.forEach((cell, index) => {
                                        obj[header[index].text] = cell.text
                                    })
                                    return obj
                                }).forEach(s => {
                                    if (snippet[s.remarks] !== undefined) {
                                        console.error(`Redefinition is not allowed:${s.remarks}`)
                                    } else
                                        snippet[s.remarks] = {}
                                    snippet[s.remarks]['prefix'] = s.operator
                                    const plog = createBody(s.param)
                                    plog.push(s.operator.replace('$', '\\$'))
                                    snippet[s.remarks]['body'] = plog.join(' ')
                                    snippet[s.remarks]['description'] = `pushed:${s.returns}`

                                    // if (s.param.includes(','))
                                    //     console.log(s.param)
                                })
                                fs.writeFileSync(snippet_file, JSON.stringify(snippet))
                                fs.closeSync(snippet_file)
                                desc.push({ language: 'postscript', path: path.relative(path.join(__dirname, '..'), snippetFileName) })
                            }
                        }
                    )
                    resolve(desc)
                }
            });
        })
    })
}

snippetsGenerator(path.join(__dirname, '..', 'Operators.md')).then(v => {
    const operatorSnippets = (v as any[]).map(snippet => {
        return {
            ...snippet,
            path: (snippet.path as string).replace('\\', '/')
        }
    })
    // Add an additional code snippet file
    // operatorSnippets.push({
    //     language: "postscript", path: "snippets/....."
    // })

    // Update package.json file
    const packageFile = path.join(__dirname, '..', 'package.json')
    fs.readFile(packageFile, (err, data) => {
        const packageObj = JSON.parse(data.toString())
        packageObj.contributes.snippets = operatorSnippets
        fs.writeFileSync(packageFile, JSON.stringify(packageObj, null, 2))
    })
    console.table(operatorSnippets)
})
