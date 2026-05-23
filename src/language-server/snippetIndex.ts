import * as fs from 'fs'
import * as path from 'path'

const SNIPPET_INDEX_FILE = 'snippet-index.json'

let cachedSnippetIndex: { set: ReadonlySet<string>; mtime: number } | null = null

export function normalizeSnippetPrefix(prefix: string): string {
  return prefix.replace(/^\//, '').toLowerCase()
}

/**
 * Load build-time snippet prefix index for LSP defer-to-snippet filtering.
 * Returns cached result if file hasn't changed (based on mtime).
 */
export async function loadSnippetPrefixSet(snippetsDir: string): Promise<ReadonlySet<string>> {
  const indexPath = path.join(snippetsDir, SNIPPET_INDEX_FILE)
  try {
    const stats = await fs.promises.stat(indexPath)
    const currentMtime = stats.mtime.getTime()
    
    if (cachedSnippetIndex && cachedSnippetIndex.mtime === currentMtime) {
      return cachedSnippetIndex.set
    }
    
    const content = await fs.promises.readFile(indexPath, 'utf-8')
    const index = JSON.parse(content) as Record<string, unknown>
    cachedSnippetIndex = {
      set: new Set(Object.keys(index)),
      mtime: currentMtime
    }
    return cachedSnippetIndex.set
  } catch {
    return new Set()
  }
}

/**
 * Clear the snippet index cache (useful for testing or forced reload).
 */
export function clearSnippetIndexCache(): void {
  cachedSnippetIndex = null
}
