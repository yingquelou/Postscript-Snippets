import * as fs from 'fs'
import * as marked from 'marked'
import * as path from 'path'

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
                (snippet[s.remarks] as Record<string, string>)['prefix'] = s.operator;
                const plog = createBody(s.param);
                plog.push(s.operator.replace('$', '\\$'));
                (snippet[s.remarks] as Record<string, string>)['body'] = plog.join(' ');
                (snippet[s.remarks] as Record<string, string>)['description'] = `pushed:${s.returns}`
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

console.log('=== 开始处理代码片段 ===')

// 处理从Operators.md生成的片段
const processOperatorsSnippets = async (): Promise<string[]> => {
  console.log('处理Operators.md生成的片段...')
  try {
    const snippets = await snippetsGenerator(path.join(rootDir, 'Operators.md'))
    console.log(`成功处理了 ${snippets.length} 个从Operators.md生成的片段`)
    return snippets
  } catch (error) {
    console.error('处理Operators.md生成的片段时出错:', error)
    return []
  }
}

// 处理snippets目录中的自定义片段
const processCustomSnippets = (): string[] => {
  console.log('处理snippets目录中的自定义片段...')
  const snippetsDir = path.join(rootDir, 'snippets')

  try {
    if (!fs.existsSync(snippetsDir)) {
      console.warn('snippets目录不存在，跳过自定义片段处理')
      return []
    }

    const snippetFiles = fs.readdirSync(snippetsDir, { withFileTypes: true })
      .filter(v => v.isFile() && path.extname(v.name).toLowerCase() === '.json')

    if (snippetFiles.length === 0) {
      console.warn('snippets目录中没有JSON文件，跳过自定义片段处理')
      return []
    }

    // 合并所有snippets文件到一个紧凑JSON对象
    const mergedSnippets: Record<string, any> = {}

    snippetFiles.forEach(file => {
      const snippetPath = path.join(snippetsDir, file.name)
      try {
        const content = fs.readFileSync(snippetPath, 'utf8')
        const snippets = JSON.parse(content)

        // 合并片段，处理可能的重复
        Object.entries(snippets).forEach(([key, value]) => {
          if (mergedSnippets[key]) {
            console.warn(`发现重复的片段名称: ${key}，使用最新的版本`)
          }
          mergedSnippets[key] = value
        })

        console.log(`处理自定义片段文件: ${file.name}`)
      } catch (error) {
        console.error(`无效的JSON文件: ${snippetPath}`, error)
      }
    })

    if (Object.keys(mergedSnippets).length === 0) {
      console.warn('没有有效的自定义片段，跳过处理')
      return []
    }

    // 生成紧凑JSON文件并保存到snippets.gen目录
    const compactSnippetPath = path.join(destDir, 'Custom Snippets.json')
    fs.writeFileSync(compactSnippetPath, JSON.stringify(mergedSnippets))
    console.log(`生成紧凑JSON文件: ${path.relative(rootDir, compactSnippetPath)}`)
    console.log(`成功处理了 ${Object.keys(mergedSnippets).length} 个自定义片段`)

    // 返回生成的紧凑JSON文件路径
    return [path.relative(rootDir, compactSnippetPath)]
  } catch (error) {
    console.error('处理自定义片段时出错:', error)
    return []
  }
}

// 主处理函数
const main = async () => {
  try {
    // 处理两种来源的片段
    const operatorsSnippets = await processOperatorsSnippets()
    const customSnippets = processCustomSnippets()

    // 合并所有片段
    const allSnippets = [...operatorsSnippets, ...customSnippets]

    if (allSnippets.length === 0) {
      console.warn('没有找到任何片段文件')
      process.exit(0)
    }

    // 转换为package.json需要的格式
    const operatorSnippets = allSnippets.map(snippet => ({
      language: 'postscript',
      path: snippet.replace(/\\/g, '/')
    }))

    // 更新package.json
    const packageFile = path.join(rootDir, 'package.json')
    try {
      if (!fs.existsSync(packageFile)) {
        throw new Error('package.json文件不存在')
      }

      const packageContent = fs.readFileSync(packageFile, 'utf8')
      const packageObj = JSON.parse(packageContent)

      packageObj.contributes = packageObj.contributes || {}
      packageObj.contributes.snippets = operatorSnippets

      fs.writeFileSync(packageFile, JSON.stringify(packageObj, null, 2))
      console.log('成功更新package.json')
    } catch (error) {
      console.error('更新package.json时出错:', error)
      throw error
    }

    // 输出处理结果
    console.log('\n=== 处理结果 ===')
    console.log(`总共处理了 ${allSnippets.length} 个片段:`)
    console.log(`- 从Operators.md生成: ${operatorsSnippets.length} 个`)
    console.log(`- 自定义片段: ${customSnippets.length} 个`)
    console.table(operatorSnippets)

    console.log('\n=== 处理完成 ===')
  } catch (error) {
    console.error('处理过程中发生错误:', error)
    process.exit(1)
  }
}

// 执行主函数
main()
