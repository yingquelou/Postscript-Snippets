import * as fs from 'fs'
import * as path from 'path'

/**
 * 使用 djb2 算法对字符串进行哈希
 * @param str 输入字符串
 * @returns 8字符十六进制哈希值
 */
export function djb2Hash(str: string): string {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i)
    hash = hash & hash
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

/**
 * 异步解析路径的真实路径
 * 使用 realpath 解析符号链接、相对路径，确保同一文件产生相同的键
 * 
 * @param p 待解析的路径
 * @returns 归一化后的真实路径
 */
export async function resolveRealPath(p: string): Promise<string> {
  try {
    const realPath = await fs.promises.realpath(p)
    return path.normalize(realPath).replace(/\\/g, '/')
  } catch {
    return path.normalize(p).replace(/\\/g, '/')
  }
}

/**
 * 生成 PreloadConfig 的缓存键
 * 
 * 使用分层哈希结构，每一层独立计算哈希值，确保：
 * 1. 键长度固定且可控（约 150 字符）
 * 2. 避免路径中的分隔符冲突
 * 3. 支持版本控制，便于未来格式变化时自动失效缓存
 * 
 * 缓存键格式: v2|f:hash|w:hash|g:hash|e:hash|d:hash|a:hash|c:hash|r:hash
 * - v2: 版本标记
 * - f: fileLevel 的哈希
 * - w: workspaceLevel 的哈希
 * - g: globalLevel 的哈希
 * - e: executable 的哈希
 * - d: workingDirectory 的哈希
 * - a: buildArgs 的哈希
 * - c: configDir 的哈希
 * - r: workspaceRoot 的哈希
 * 
 * @param fileLevel 文件级别配置
 * @param workspaceLevel 工作区级别配置
 * @param globalLevel 全局级别配置
 * @param executable 可执行文件路径
 * @param workingDirectory 工作目录
 * @param buildArgs 构建参数
 * @param configDir 配置目录
 * @param workspaceRoot 工作区根目录
 */
export async function buildPreloadConfigKey(
  fileLevel: string[],
  workspaceLevel: string[],
  globalLevel: string[],
  executable?: string,
  workingDirectory?: string,
  buildArgs?: string,
  configDir?: string,
  workspaceRoot?: string
): Promise<string> {
  const hashPart = async (paths: string[], name: string): Promise<string> => {
    if (paths.length === 0) {
      return `${name}:`
    }
    const sorted = [...paths].sort()
    const normalized = await Promise.all(sorted.map(resolveRealPath))
    const hash = djb2Hash(normalized.join('\0'))
    return `${name}:${hash}`
  }

  const hashString = (value: string | undefined, name: string): string => {
    if (!value) {
      return `${name}:`
    }
    return `${name}:${djb2Hash(value)}`
  }

  const [fileHash, workspaceHash, globalHash] = await Promise.all([
    hashPart(fileLevel, 'f'),
    hashPart(workspaceLevel, 'w'),
    hashPart(globalLevel, 'g')
  ])

  const exeHash = executable ? `e:${djb2Hash(await resolveRealPath(executable))}` : 'e:'
  const dirHash = workingDirectory ? `d:${djb2Hash(await resolveRealPath(workingDirectory))}` : 'd:'
  const argsHash = hashString(buildArgs, 'a')
  const configHash = configDir ? `c:${djb2Hash(await resolveRealPath(configDir))}` : 'c:'
  const rootHash = workspaceRoot ? `r:${djb2Hash(await resolveRealPath(workspaceRoot))}` : 'r:'

  return `v2|${fileHash}|${workspaceHash}|${globalHash}|${exeHash}|${dirHash}|${argsHash}|${configHash}|${rootHash}`
}

export async function getDependenciesMtime(files: string[]): Promise<number> {
  let mtime = 0
  for (const file of files) {
    try {
      const stats = await fs.promises.stat(file)
      mtime += stats.mtime.getTime()
    } catch {
      mtime += Date.now()
    }
  }
  return mtime
}
