import * as fs from 'fs'
import * as marked from 'marked'
import path = require('path')

// Script runs as dist/scripts/snippetsGenerator.s.js → project root is two levels up
const rootDir = path.join(__dirname, '..', '..')
const destDir = path.join(rootDir, 'snippets.gen')

function createBody(params: string) {
  return params.split(/\s+/).filter(v => v.trim().length).map((v, i) => {
    const s = v.replace('$', '\\$')
    return `\${${i + 1}` + (v.includes(',') ? `|${s}|` : `:${s}`) + '}'
  })
}

/**
 * Parse MarkDown files that meet the specified format
 * to generate the PS code snippet files required by the extension.
 * For formatting conventions, please refer to the Operators.md file.
 */
function snippetsGenerator(markDownPath: string) {
  return new Promise<string[]>((resolve, reject) => {
    fs.mkdir(destDir, { recursive: true }, err => {
      if (err) return reject(err)
      fs.readFile(markDownPath, (err, data) => {
        if (err) return reject(err)
        let snippetFileName: string = ''
        const desc: string[] = []
        new marked.Lexer().lex(data.toString()).forEach(
          token => {
            if (token.type === 'heading') {
              snippetFileName = path.join(destDir, token.text + '.json')
            } else if (token.type === 'table') {
              const snippet_file = fs.openSync(snippetFileName, 'w')
              const header = token.header as marked.Tokens.TableCell[]
              const rows = token.rows as marked.Tokens.TableCell[][]
              const snippet: Record<string, unknown> = {}
              rows.map(row => {
                const obj: { [key: string]: string } = {}
                row.forEach((cell, index) => {
                  obj[header[index].text] = cell.text
                })
                return obj
              }).forEach(s => {
                if (snippet[s.remarks] !== undefined) {
                  console.error(`Redefinition is not allowed:${s.remarks}`)
                } else {
                  snippet[s.remarks] = {}
                }
                ;(snippet[s.remarks] as Record<string, string>)['prefix'] = s.operator
                const plog = createBody(s.param)
                plog.push(s.operator.replace('$', '\\$'))
                ;(snippet[s.remarks] as Record<string, string>)['body'] = plog.join(' ')
                ;(snippet[s.remarks] as Record<string, string>)['description'] = `pushed:${s.returns}`
              })
              fs.writeFileSync(snippet_file, JSON.stringify(snippet))
              fs.closeSync(snippet_file)
              desc.push(path.relative(rootDir, snippetFileName))
            }
          }
        )
        resolve(desc)
      })
    })
  })
}

snippetsGenerator(path.join(rootDir, 'Operators.md')).then(arr => {
  const fromSnippets = fs.readdirSync(path.join(rootDir, 'snippets'), { withFileTypes: true })
    .filter(v => v.isFile() && path.extname(v.name).toLowerCase() === '.json')
    .map(v => {
      const snf = path.join(destDir, v.name)
      fs.writeFileSync(snf, JSON.stringify(
        JSON.parse(fs.readFileSync(path.join(v.parentPath, v.name)).toString())
      ))
      return path.relative(rootDir, snf)
    })
  arr.push(...fromSnippets)

  const operatorSnippets = arr.map(snippet => ({
    language: 'postscript',
    path: (snippet as string).replace(/\\/g, '/')
  }))

  const packageFile = path.join(rootDir, 'package.json')
  const packageObj = JSON.parse(fs.readFileSync(packageFile).toString())
  packageObj.contributes.snippets = operatorSnippets
  fs.writeFileSync(packageFile, JSON.stringify(packageObj, null, 2))

  console.table(operatorSnippets)
}).catch(err => {
  console.error(err)
  process.exit(1)
})
