/**
 * Pure parsers for Ghostscript dynamic validation output (L3) and build
 * traces. Kept free of vscode imports so they are directly unit-testable.
 * Semantics documented in docs/design/build-trace.md and
 * docs/design/mark-diagnostics.md.
 */

export interface GsErrorInfo {
  errorname?: string
  command?: string
  /** byte offset: end of offending token + terminating whitespace */
  position?: number
}

const ERROR_MARKER_PREFIX = '===GS-ERROR'
export const GS_ERROR_MARKER = `${ERROR_MARKER_PREFIX}===`
export const GS_DONE_MARKER = '===GS-DONE==='

/**
 * Run-unique suffix for both markers.
 *
 * gs output is a shared channel: the validated program may print anything it
 * likes, including a literal `===GS-ERROR===` line (verified: a plain `print`
 * from user code lands in the same stream). A per-run nonce makes the
 * handler's own report distinguishable from text the program forged, so the
 * parser never trusts user output as a verdict.
 */
export function makeRunNonce(random: () => number = Math.random): string {
  return Math.floor(random() * 0xffffffff)
    .toString(36)
    .padStart(6, '0')
    .slice(0, 8)
}

function sanitizeNonce(nonce: string): string {
  return (nonce || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 16)
}

export function gsErrorMarker(nonce = ''): string {
  const safe = sanitizeNonce(nonce)
  return safe ? `${ERROR_MARKER_PREFIX}:${safe}===` : GS_ERROR_MARKER
}

export function gsDoneMarker(nonce = ''): string {
  const safe = sanitizeNonce(nonce)
  return safe ? `===GS-DONE:${safe}===` : GS_DONE_MARKER
}

/**
 * Structured error handler, installed with `-c` **before** the validated file
 * runs (never written into the snapshot, so offsets are untouched).
 *
 * `errordict /handleerror` is the documented hook: gs fills `$error` and calls
 * it for uncaught errors, replacing the default human-readable block. Verified
 * on gs 10.08.0: the replacement works under the default SAFER, the exit code
 * stays non-zero, `stopped`-caught errors still bypass it, and every field is
 * guarded with `known` / a type check so the handler can never raise its own
 * error. `position` keeps the exact semantics of `Current file position is N`
 * (verified: `1 2\nnonsense\n` → 13 from both), so the existing `N-1` byte math
 * applies unchanged.
 *
 * The program being validated shares the dictionary stack with the hook, so
 * the hook must not resolve anything through a name it could rebind:
 *
 *   - `//$error` is looked up **at scan time** (before the file runs) and the
 *     dictionary object is spliced into the procedure, so a later
 *     `/$error … def` in the file cannot redirect it (verified: gs returns the
 *     same dictionary object for every error, so the snapshot stays live).
 *   - `bind` resolves `print`, `flush`, `=only`, `known`, `get`, `type`,
 *     `ifelse` … to operator objects **now**, so `/print {…} def` in the file
 *     has no effect (verified).
 *   - no named locals are created, so nothing is `def`ed into userdict.
 *
 * Output is one line per field, marker-prefixed so the parser can ignore
 * everything else gs prints:
 *
 *     ===GS-ERROR=== name=/unmatchedmark
 *     ===GS-ERROR=== command=]
 *     ===GS-ERROR=== position=5
 *     ===GS-ERROR=== depth=2
 */
export function buildGsErrorHandler(nonce = ''): string {
  const marker = gsErrorMarker(nonce)
  return [
    'errordict /handleerror {',
    `(${marker} name=/) print`,
    '//$error /errorname known { //$error /errorname get =only } if (\\n) print',
    `(${marker} command=) print`,
    '//$error /command known { //$error /command get =only } if (\\n) print',
    `(${marker} position=) print`,
    '//$error /position known { //$error /position get dup type /integertype eq { =only } { pop } ifelse } if (\\n) print',
    `(${marker} depth=) print`,
    '//$error /ostack known { //$error /ostack get length =only } if (\\n) print',
    'flush',
    '} bind put'
  ].join(' ')
}

/**
 * Completion sentinel, passed as a second `-c` **after** `-f <snapshot>`.
 *
 * `-c` arguments run in order, so this line only executes when the program
 * reached the end of the file: not when it raised an error, and not when it
 * called `quit` (verified gs 10.08: clean → line printed, `1 2 ]` → absent,
 * `quit` mid-file → absent with exit code 0). That makes "exit 0" falsifiable —
 * a `quit` on line 3 would otherwise look like a fully validated document.
 */
export function buildDoneSentinel(nonce = ''): string {
  return `(${gsDoneMarker(nonce)}) print flush`
}

export interface GsErrorReport extends GsErrorInfo {
  /** operand-stack depth at the failure point */
  depth?: number
}

function toOffset(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined
  return parseInt(value, 10)
}

/** gs prints unprintable objects as `--nostringval--` (sometimes with extra dashes). */
function cleanCommand(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed || /^-+nostringval-+$/.test(trimmed)) return undefined
  return trimmed
}

/**
 * Read the report emitted by `buildGsErrorHandler`. Returns `undefined` when
 * the handler never ran (clean run, a `stopped`-caught error, or a file that
 * replaced `errordict /handleerror`), so callers can fall back to
 * `parseGsErrorOutput` and, failing that, report an unattributed failure.
 */
export function parseGsErrorReport(output: string, marker: string = GS_ERROR_MARKER): GsErrorReport | undefined {
  if (!output.includes(marker)) return undefined
  const fields = new Map<string, string>()
  for (const raw of output.split(/\r?\n/)) {
    const at = raw.indexOf(marker)
    if (at < 0) continue
    const rest = raw.slice(at + marker.length).trim()
    const eq = rest.indexOf('=')
    if (eq <= 0) continue
    const key = rest.slice(0, eq).trim()
    if (key && !fields.has(key)) fields.set(key, rest.slice(eq + 1).trim())
  }
  if (fields.size === 0) return undefined
  const name = fields.get('name')?.replace(/^\/+/, '')
  return {
    errorname: name || undefined,
    command: cleanCommand(fields.get('command')),
    position: toOffset(fields.get('position')),
    depth: toOffset(fields.get('depth'))
  }
}

/** Parse gs error output: `Error: /<errorname> in <command>` + `Current file position is N`. */
export function parseGsErrorOutput(output: string): GsErrorInfo | undefined {
  const errorMatch = output.match(/^Error:\s+\/(\S+)(?:\s+in\s+(.+))?$/m)
  const posMatch = output.match(/Current file position is (\d+)/)
  if (!errorMatch && !posMatch) {
    return undefined
  }
  return {
    errorname: errorMatch?.[1],
    command: errorMatch?.[2]?.trim(),
    position: posMatch ? parseInt(posMatch[1], 10) : undefined
  }
}

/** True when the post-file sentinel ran, i.e. the program reached its end. */
export function parseGsDone(output: string, marker: string = GS_DONE_MARKER): boolean {
  return output.includes(marker)
}

/**
 * What a single gs run actually proved.
 *
 * Distinct states matter because "exit code 0" is not the same as "validated":
 * a program that calls `quit` on line 3 exits 0 without the rest ever running,
 * and a program that replaces `errordict /handleerror` exits non-zero while
 * leaving no attributable position. Collapsing either into "clean" or into a
 * fake position would be a lie, so the outcome is classified instead.
 */
export type GsRunOutcome =
  | { kind: 'clean'; residue?: number }
  | { kind: 'incomplete' }
  | { kind: 'error'; report: GsErrorReport }
  | { kind: 'error-text'; info: GsErrorInfo }
  | { kind: 'error-unattributed'; exitCode: number }
  | { kind: 'crash'; exitCode: number; detail: string }

export function classifyGsRun(input: { exitCode: number; output: string; nonce?: string }): GsRunOutcome {
  const { exitCode, output } = input
  const nonce = input.nonce ?? ''

  // gs's own C-level diagnostics: reached when the interpreter dies outside
  // the PostScript error machinery (e.g. the file redefines `$error`, which
  // breaks gs itself — verified on 10.08 with the default handler as well).
  const crashLine = output.split(/\r?\n/).find(line => /Unexpected interpreter error/i.test(line))
  if (crashLine || (exitCode !== 0 && exitCode !== 1)) {
    return { kind: 'crash', exitCode, detail: crashLine?.trim() || `exit code ${exitCode}` }
  }

  const report = parseGsErrorReport(output, gsErrorMarker(nonce))
  if (report) return { kind: 'error', report }

  if (exitCode === 0) {
    if (!parseGsDone(output, gsDoneMarker(nonce))) return { kind: 'incomplete' }
    return { kind: 'clean', residue: parseResidueOutput(output) }
  }

  const info = parseGsErrorOutput(output)
  if (info) return { kind: 'error-text', info }
  return { kind: 'error-unattributed', exitCode }
}

/** Convert a UTF-8 byte offset into a JS string (UTF-16) offset, snapping to a valid boundary. */
export function byteOffsetToCharOffset(text: string, byteOffset: number): number {
  if (byteOffset <= 0) return 0
  const buf = Buffer.from(text, 'utf8')
  if (byteOffset >= buf.length) return text.length
  let b = byteOffset
  while (b > 0 && (buf[b] & 0xc0) === 0x80) b--
  return buf.slice(0, b).toString('utf8').length
}

export const TRACE_MARKER = '===TRACE-RUN==='

export interface BuildTrace {
  version: 1
  generator: string
  gsExitCode: number
  mainFiles: string[]
  orderedFiles: string[]
}

/** Escape a filesystem path for embedding in a PostScript string literal. */
export function escapePsString(p: string): string {
  return p.replace(/\\/g, '/').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

/** Extract file names in execution order from build-trace stderr. */
export function parseTraceStderr(stderr: string): string[] {
  return stderr
    .split(/\r?\n/)
    .filter(line => line.startsWith(TRACE_MARKER))
    .map(line => line.slice(TRACE_MARKER.length).trim())
    .filter(name => name.length > 0)
}

export const RESIDUE_MARKER = '===GS-RESIDUE==='

/**
 * Probe appended to the validated stream (never to the user's buffer).
 *
 * `counttomark` answers "how many operands sit above the nearest mark",
 * i.e. the exact amount of content an unclosed `[` / `<<` / `mark` left
 * behind. It raises /unmatchedmark when the stack holds no mark at all, so
 * `stopped` turns that into the explicit `none` report. Without the probe a
 * clean run is indistinguishable from "unclosed but tolerated" — gs never
 * complains about a lingering mark.
 */
export const RESIDUE_PROBE = [
  '',
  '% postscript-snippets residue probe — appended by L3, not part of the buffer',
  `{ counttomark (${RESIDUE_MARKER}) print == } stopped`,
  `{ (${RESIDUE_MARKER} none) print flush } if`,
  ''
].join('\n')

/**
 * Read the probe report: a number of operands above the final mark, `0`
 * for "probe ran, no mark left", and `undefined` when the probe never ran
 * (e.g. the file ends with `quit`).
 */
export function parseResidueOutput(output: string): number | undefined {
  if (!output.includes(RESIDUE_MARKER)) return undefined
  if (new RegExp(`${RESIDUE_MARKER}\\s*none`).test(output)) return 0
  const match = output.match(new RegExp(`${RESIDUE_MARKER}\\s*(\\d+)`))
  return match ? parseInt(match[1], 10) : undefined
}
