import * as fs from 'fs'
import * as path from 'path'
import { PostScriptSymbolBuilder, MarkOperatorConfig, ParseResult } from './symbolBuilder'
import { containsBinaryData } from '../binaryDetector'

/**
 * L1 composition flow analysis (issue #2, "分析单元 = 构建单元").
 *
 * Dependency fragments are concatenated in the compile merge order —
 * globalDependencies → workspaceDependencies → target inputs → current file
 * (buildArgs are process arguments, not stream content) — and the same
 * mark-aware symbol builder runs over the merged stream. A structural
 * warning that is balanced in the merged stream is downgraded to a hint,
 * because cross-file mark construction is legal Ghostscript: files are
 * stream fragments on a global interpreter.
 */

export interface AnalysisFragment {
  file: string
  text: string
  startOffset: number
  endOffset: number
}

export interface CompositionStream {
  fragments: AnalysisFragment[]
  stream: string
}

const normalizeKey = (p: string) => path.normalize(p).replace(/\\/g, '/').toLowerCase()

const sameFile = (a: string, b: string) => normalizeKey(a) === normalizeKey(b)

export async function buildCompositionStream(
  currentFilePath: string,
  currentText: string,
  dependencies: string[]
): Promise<CompositionStream> {
  const fragments: AnalysisFragment[] = []
  const parts: string[] = []
  let offset = 0
  const seen = new Set<string>()

  const pushFragment = (file: string, text: string) => {
    // Files are stream fragments on one interpreter, but a real build `run`s
    // them one by one: the last token of a.ps must not fuse with the first
    // token of b.ps ("...1" + "2 3 ]" must not become "12 3 ]"). A newline is
    // always a safe separator (a string literal cannot span files).
    const previous = parts[parts.length - 1]
    if (previous !== undefined && !/\s$/.test(previous)) {
      parts.push('\n')
      offset += 1
    }
    const start = offset
    const end = start + text.length
    fragments.push({ file, text, startOffset: start, endOffset: end })
    parts.push(text)
    offset = end
  }

  for (const dep of dependencies) {
    const key = normalizeKey(dep)
    if (seen.has(key)) continue
    seen.add(key)
    if (sameFile(dep, currentFilePath)) continue
    let text: string
    try {
      text = await fs.promises.readFile(dep, 'utf8')
    } catch {
      continue // missing files are reported by config validation (PS010)
    }
    if (containsBinaryData(text)) continue
    pushFragment(dep, text)
  }

  // the analyzed document is always the last fragment
  pushFragment(currentFilePath, currentText)

  return { fragments, stream: parts.join('') }
}

export function parseComposition(stream: string, markOperators: MarkOperatorConfig): ParseResult {
  const builder = new PostScriptSymbolBuilder(markOperators)
  return builder.parse(stream)
}

/**
 * A single-file structural warning is balanced in context when the merged
 * stream reports no diagnostic anchored at the corresponding offset.
 * Offsets match exactly because the current document is the last fragment
 * and merged offsets are char offsets in the same (JS string) coordinate
 * system as the single-file parse.
 */
export function isBalancedInContext(
  merged: ParseResult,
  fragment: AnalysisFragment,
  localStartOffset: number
): boolean {
  const mergedOffset = fragment.startOffset + localStartOffset
  return !merged.errors.some(e =>
    Math.abs((e.startOffset ?? 0) - mergedOffset) <= 1
  )
}

/**
 * Map a merged-stream char offset back to the fragment that owns it.
 * Used by L3 to report a gs error against the file whose text contains it,
 * including dependencies (the merged stream is what gs actually executes).
 */
export function locateFragmentOffset(
  fragments: AnalysisFragment[],
  mergedOffset: number
): { file: string; localOffset: number } | undefined {
  for (const fragment of fragments) {
    if (mergedOffset >= fragment.startOffset && mergedOffset <= fragment.endOffset) {
      return { file: fragment.file, localOffset: mergedOffset - fragment.startOffset }
    }
  }
  return undefined
}
