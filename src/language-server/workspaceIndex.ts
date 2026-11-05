import * as fs from 'fs'
import * as path from 'path'
import { pathToFileURL } from 'url'
import { PsStrictLexer } from '../parser/postscriptParser'

/**
 * L2 — workspace symbol index (go-to-definition / workspace-symbol base).
 *
 * Definitions are extracted at token level: a literal name `/x` whose value is
 * bound by a matching `def` at the same nesting depth. Procedure bodies
 * (`/foo { ... } def`) are marked so callers can prefer function symbols.
 *
 * This module intentionally has no vscode dependency so it can be unit-tested.
 */

export interface DefEntry {
  name: string
  /** offsets of the defining literal-name token; endOffset is EXCLUSIVE
   *  (normalized: chevrotain reports an inclusive endOffset) */
  startOffset: number
  endOffset: number
  startLine: number // 1-based, same convention as TokenInfo
  startColumn: number // 1-based
  endLine: number
  endColumn: number
  isProcedure: boolean
}

export interface FileDefs {
  fsPath: string
  uri: string
  mtime: number
  defs: DefEntry[]
}

export interface IndexEntry {
  fsPath: string
  uri: string
  def: DefEntry
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'out',
  'dist',
  '.tests',
  '.workbuddy',
  '.vscode-test'
])

const SOURCE_EXT = /\.(ps|eps)$/i
const MAX_FILES = 3000
const MAX_FILE_BYTES = 3 * 1024 * 1024

interface PendingDef {
  name: string
  token: { startOffset: number; endOffset: number; startLine: number; startColumn: number; endLine: number; endColumn: number }
  /** a procedure body `{` opened directly as the key's value */
  procStarted: boolean
  /** true only before any other token intervenes (value-constructor check) */
  immediate: boolean
}

/**
 * Extract `/name ... def` definitions from tokens. Best-effort: static
 * lexical pairing, no execution semantics.
 *
 * Pending keys are tracked per nesting depth, so `/outer { /inner ... def } def`
 * yields both definitions. A `[` / `]` pair never mis-attributes keys because
 * the inner literal names live at a deeper depth than the `def`.
 */
export function extractDefinitions(text: string): DefEntry[] {
  const lex = (PsStrictLexer as any).tokenize(text)
  const tokens: any[] = lex?.tokens ?? []

  const defs: DefEntry[] = []
  let depth = 0
  const pending = new Map<number, PendingDef>()

  const tok = (t: any): PendingDef['token'] => ({
    // chevrotain's endOffset is inclusive of the last character — normalize
    // to an exclusive end so slice(start, end) yields the token image
    startOffset: t.startOffset,
    endOffset: t.endOffset + 1,
    startLine: t.startLine,
    startColumn: t.startColumn,
    endLine: t.endLine,
    endColumn: t.endColumn
  })

  for (const t of tokens) {
    const type: string = t.tokenType?.name ?? ''
    const image: string = t.image ?? ''

    if (type === 'LiteralName') {
      if (image.startsWith('/')) {
        pending.set(depth, { name: image.slice(1), token: tok(t), procStarted: false, immediate: true })
      }
      continue
    }

    if (type === 'ExecutableName' && image === 'def') {
      const p = pending.get(depth)
      if (p) {
        defs.push({ name: p.name, ...p.token, isProcedure: p.procStarted })
        pending.delete(depth)
      }
      continue
    }

    const p = pending.get(depth)
    if (type === 'ProcedureStart') {
      if (p && p.immediate) {
        p.procStarted = true
      }
      depth++
    } else if (type === 'ArrayStart' || (type === 'ExecutableName' && image === '<<')) {
      depth++
    } else if (type === 'ProcedureEnd' || type === 'ArrayEnd' || (type === 'ExecutableName' && image === '>>')) {
      depth = Math.max(0, depth - 1)
    }
    if (p) {
      p.immediate = false
    }
  }
  return defs
}

interface IndexIo {
  stat: (p: string) => Promise<{ mtimeMs: number; size: number }>
  readFile: (p: string) => Promise<string>
  walk: (root: string) => Promise<string[]>
}

const nodeIo: IndexIo = {
  stat: async p => {
    const s = await fs.promises.stat(p)
    return { mtimeMs: s.mtimeMs, size: s.size }
  },
  readFile: p => fs.promises.readFile(p, 'utf8'),
  walk: async root => {
    const out: string[] = []
    const queue: string[] = [root]
    while (queue.length > 0 && out.length < MAX_FILES) {
      const dir = queue.shift()!
      let entries: fs.Dirent[]
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of entries) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) {
            queue.push(full)
          }
        } else if (e.isFile() && SOURCE_EXT.test(e.name)) {
          out.push(full)
          if (out.length >= MAX_FILES) break
        }
      }
    }
    return out
  }
}

export class WorkspaceIndex {
  private files = new Map<string, FileDefs>()
  private ensured = false
  private ensurePromise: Promise<void> | null = null

  constructor(
    /** workspace root this index was scanned from; callers use it to detect a root change */
    public readonly root: string,
    private readonly io: IndexIo = nodeIo
  ) {}

  /** Index the workspace once; subsequent calls are no-ops. */
  async ensure(): Promise<void> {
    if (this.ensured) return
    if (!this.ensurePromise) {
      this.ensurePromise = this.scan().finally(() => {
        this.ensured = true
      })
    }
    return this.ensurePromise
  }

  /** Force re-scan (e.g. after watched-file changes added new files). */
  async rescan(): Promise<void> {
    this.ensurePromise = this.scan()
    return this.ensurePromise
  }

  private async scan(): Promise<void> {
    const paths = await this.io.walk(this.root)
    await Promise.all(paths.map(p => this.upsertFile(p)))
  }

  /** Re-index a single file (used on save / watched-file change). */
  async upsertFile(fsPath: string): Promise<void> {
    if (!SOURCE_EXT.test(fsPath) || !fsPath.startsWith(this.root)) return
    try {
      const { mtimeMs, size } = await this.io.stat(fsPath)
      const cached = this.files.get(fsPath)
      if (cached && cached.mtime === mtimeMs) return
      if (size > MAX_FILE_BYTES) return
      const text = await this.io.readFile(fsPath)
      this.files.set(fsPath, {
        fsPath,
        uri: pathToFileURL(fsPath).href,
        mtime: mtimeMs,
        defs: extractDefinitions(text)
      })
    } catch {
      this.files.delete(fsPath)
    }
  }

  dropFile(fsPath: string): void {
    this.files.delete(fsPath)
  }

  /** All index entries, current file's definitions first. */
  all(): IndexEntry[] {
    const entries: IndexEntry[] = []
    for (const f of this.files.values()) {
      for (const def of f.defs) {
        entries.push({ fsPath: f.fsPath, uri: f.uri, def })
      }
    }
    return entries
  }

  lookup(name: string): IndexEntry[] {
    return this.all().filter(e => e.def.name === name)
  }

  /** Case-insensitive substring query for workspace-symbol requests. */
  query(q: string): IndexEntry[] {
    const needle = q.toLowerCase()
    return this.all().filter(e => needle === '' || e.def.name.toLowerCase().includes(needle))
  }
}
