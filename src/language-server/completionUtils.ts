import { DictionaryEntry } from './completionTypes'
import { normalizeSnippetPrefix } from './snippetIndex'

export const MAX_COMPLETION_ITEMS = 100

export interface EntryMatchResult {
  entry: DictionaryEntry
  sortText: string
}

function buildSortTextFromMatchInfo(matchInfo: MatchInfo, bare: string): string {
  const kindKey = String(matchInfo.kind).padStart(3, '0')
  const lengthKey = String(matchInfo.length).padStart(4, '0')
  const distanceKey = String(matchInfo.distance).padStart(6, '0')
  const typeKey = String(matchInfo.typePriority)

  return `${kindKey}_${lengthKey}_${distanceKey}_${typeKey}_${bare}`
}

function getSubsequenceDistance(needle: string, haystack: string): number {
  let distance = 0
  let lastIndex = -1

  for (const char of needle) {
    const foundIndex = haystack.indexOf(char, lastIndex + 1)
    if (foundIndex === -1) {
      return -1
    }
    distance += foundIndex - lastIndex - 1
    lastIndex = foundIndex
  }

  return distance
}

interface MatchInfo {
  kind: number
  matchPosition: number
  length: number
  distance: number
  typePriority: number
}

function getCompletionMatchInfo(entry: DictionaryEntry, prefix: string): MatchInfo | undefined {
  if (!prefix) return { kind: 0, matchPosition: 0, length: entry.name.replace(/^\//, '').length, distance: 0, typePriority: entry.type === 'operator' ? 0 : 1 }

  const p = prefix.toLowerCase()
  const name = entry.name.toLowerCase()
  const bare = name.startsWith('/') ? name.slice(1) : name
  const typePriority = entry.type === 'operator' ? 0 : 1
  const exactName = bare === p
  const startsWith = bare.startsWith(p)
  const substringIndex = bare.indexOf(p)
  const subsequenceDistance = getSubsequenceDistance(p, bare)

  if (exactName) {
    return { kind: 0, matchPosition: 0, length: bare.length, distance: 0, typePriority }
  }
  if (startsWith) {
    return { kind: 1, matchPosition: 0, length: bare.length, distance: 0, typePriority }
  }
  if (substringIndex >= 0) {
    return { kind: 2, matchPosition: substringIndex, length: bare.length, distance: 0, typePriority }
  }
  if (subsequenceDistance >= 0) {
    return { kind: 3, matchPosition: 0, length: bare.length, distance: subsequenceDistance, typePriority }
  }

  return undefined
}

function shouldDeferToSnippetInternal(
  entry: DictionaryEntry,
  snippetPrefixes: ReadonlySet<string>
): boolean {
  return snippetPrefixes.has(normalizeSnippetPrefix(entry.name))
}

/** Combined filter and sort in single pass - avoids duplicate getCompletionMatchInfo calls. */
export function filterSortAndLimitEntries(
  entries: DictionaryEntry[],
  prefix: string,
  snippetPrefixes: ReadonlySet<string>
): EntryMatchResult[] {
  if (entries.length === 0) return []

  const results: EntryMatchResult[] = []

  for (const entry of entries) {
    const matchInfo = getCompletionMatchInfo(entry, prefix)
    if (matchInfo && !shouldDeferToSnippetInternal(entry, snippetPrefixes)) {
      const bare = entry.name.toLowerCase().replace(/^\//, '')
      results.push({
        entry,
        sortText: buildSortTextFromMatchInfo(matchInfo, bare)
      })
    }
  }

  results.sort((a, b) => a.sortText.localeCompare(b.sortText))

  return results
}

/** Operators covered by static snippets are deferred to VS Code snippet completion. */
export function shouldDeferToSnippet(
  entry: DictionaryEntry,
  snippetPrefixes: ReadonlySet<string>
): boolean {
  return snippetPrefixes.has(normalizeSnippetPrefix(entry.name))
}

/** Extract PostScript name prefix at cursor (supports literal names starting with /). */
export function getCompletionPrefix(line: string, character: number): string {
  let word = ''
  let i = character - 1
  while (i >= 0 && /[^\s\[\]{}<>\/%()]/.test(line[i])) {
    word = line[i] + word
    i--
  }
  return word
}

export function matchesDictionaryEntry(entry: DictionaryEntry, prefix: string): boolean {
  if (!prefix) return true
  return getCompletionMatchInfo(entry, prefix) !== undefined
}

export function completionSortText(entry: DictionaryEntry, prefix: string = ''): string {
  const bare = entry.name.replace(/^\//, '')
  const matchInfo = getCompletionMatchInfo(entry, prefix) ?? {
    kind: 4,
    matchPosition: 0,
    length: bare.length,
    distance: Number.MAX_SAFE_INTEGER,
    typePriority: entry.type === 'operator' ? 0 : 1
  }

  return buildSortTextFromMatchInfo(matchInfo, bare)
}
