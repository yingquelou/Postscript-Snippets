import * as vscode from 'vscode'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFile } from 'child_process'
import { resolveGhostscript } from './ghostscriptHelper'
import {
  buildDoneSentinel,
  buildGsErrorHandler,
  byteOffsetToCharOffset,
  classifyGsRun,
  makeRunNonce,
  RESIDUE_PROBE,
  type GsErrorInfo,
  type GsErrorReport
} from './gsParsers'
import {
  AnalysisFragment,
  buildCompositionStream,
  locateFragmentOffset
} from './language-server/compositionAnalysis'
import { getProjectConfigForFile, isFileDeclared, resolvePreloadConfig } from './language-server/configUtils'

/**
 * L3: Ghostscript dynamic validation (issue #2 roadmap).
 *
 * Two things are validated, in this order of preference:
 *
 * 1. The **build unit** — when `postscript.config.json` declares the file,
 *    the merged dependency stream (the same one L1 analyses, and the same
 *    order `compilePostscript` uses) becomes the gs input. A single-file run
 *    of a cross-file construct always fails with /unmatchedmark, which would
 *    turn the arbiter into a source of false positives.
 * 2. The single document, when no config declares it.
 *
 * The buffer is snapshotted to a temp file and passed to gs as a file
 * argument — gs only reports `Current file position` for seekable inputs,
 * so stdin is deliberately avoided (stdin is reserved for the interactive
 * console where the client keeps a chunk→source ledger). v1 collects the
 * first error only: continuing after an unhandled error can cascade stack
 * pollution into noise.
 *
 * Offset semantics (verified against gs 10.08): `Current file position is N`
 * is a byte offset pointing at the END of the offending token plus its
 * terminating whitespace — not the token start. The token end is therefore
 * N-1 (watch multi-char whitespace), and the offending command name is used
 * as a second-pass anchor when needed. The same number arrives structured via
 * `$error /position` (see buildGsErrorHandler), so no separate code path is
 * needed. Merged-stream offsets are mapped back to the owning fragment, so an
 * error in a dependency is reported on that file rather than on the buffer.
 *
 * Interference policy: the hook lives in `errordict`, which the validated
 * program can rewrite. The hook itself is hardened (scan-time `//$error`,
 * `bind`-resolved operators), but no PostScript-level hook is unremovable, so
 * the run is classified rather than assumed — exit code, completion sentinel,
 * structured report and text fallback are separate evidence, and "failed but
 * unattributable" is reported as exactly that (never a fabricated position).
 * See docs/design/gs-interfaces.md, "Interference from the validated program".
 *
 * The verdict (and the mark-residue probe result) is sent to the language
 * server, which downgrades its structural warnings for exactly this document
 * version: a clean gs run settles aliasing questions the static layer cannot
 * answer (see docs/design/mark-diagnostics.md, "L3 → L0 feedback").
 */

/** Minimal notification surface, so this module stays client-side and testable. */
export type GsNotificationSink = (method: string, params?: unknown) => void

interface ValidationStream {
  /** text handed to gs (merged build unit, or the single document) */
  text: string
  /** present when `text` is a merged unit; offsets map back to files */
  fragments?: AnalysisFragment[]
  /** files in the unit, for logging */
  unitFiles: string[]
}

function offsetToPosition(text: string, offset: number): vscode.Position {
  const clamped = Math.max(0, Math.min(offset, text.length))
  let line = 0
  let lineStart = 0
  for (let i = 0; i < clamped; i++) {
    if (text.charCodeAt(i) === 10) {
      line++
      lineStart = i + 1
    }
  }
  return new vscode.Position(line, clamped - lineStart)
}

async function resolveValidationStream(
  filePath: string,
  text: string,
  workspaceRoot: string | undefined
): Promise<ValidationStream> {
  const single: ValidationStream = { text, unitFiles: [filePath] }
  try {
    const cfg = await getProjectConfigForFile(filePath, workspaceRoot)
    if (!cfg.configPath || !cfg.configDir) return single
    if (!isFileDeclared(cfg.rawConfig.dependencies, filePath, workspaceRoot)) return single

    const preload = resolvePreloadConfig(cfg.rawConfig, filePath, cfg.configDir, workspaceRoot)
    const deps = [...preload.globalLevel, ...preload.workspaceLevel, ...preload.fileLevel]
    if (deps.length === 0) return single

    const built = await buildCompositionStream(filePath, text, deps)
    if (built.fragments.length <= 1) return single
    return {
      text: built.stream,
      fragments: built.fragments,
      unitFiles: built.fragments.map(f => f.file)
    }
  } catch {
    // config problems surface as PS010/PS011 diagnostics; validation degrades
    // to the single document rather than failing the command
    return single
  }
}

export function registerValidateWithGhostscript(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
  notify?: GsNotificationSink
): void {
  const collection = vscode.languages.createDiagnosticCollection('postscript-gs')
  context.subscriptions.push(collection)

  /** URIs that currently carry a gs diagnostic, cleared at the start of each run */
  const reportedUris = new Set<string>()

  const runGs = (gsPath: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> =>
    new Promise((resolve, reject) => {
      execFile(gsPath, args, { cwd, timeout: 20000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
        const code = (error as any)?.code
        // gs signals PostScript errors with a nonzero exit code; that is an
        // expected outcome here, not a spawn failure
        if (error && typeof code !== 'number') {
          reject(error)
          return
        }
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code: typeof code === 'number' ? code : 0 })
      })
    })

  const send = (method: string, params: unknown) => {
    if (!notify) return
    try {
      notify(method, params)
    } catch {
      // the language server may still be starting; the verdict is advisory
    }
  }

  const validate = async (resource?: vscode.Uri): Promise<void> => {
    const documentUri = resource ?? vscode.window.activeTextEditor?.document.uri
    if (!documentUri || documentUri.scheme !== 'file') {
      vscode.window.showErrorMessage('No active PostScript file to validate.')
      return
    }
    const document = vscode.workspace.textDocuments.find(d => d.uri.toString() === documentUri.toString())
    let text: string
    try {
      text = document ? document.getText() : fs.readFileSync(documentUri.fsPath, 'utf8')
    } catch (error) {
      // the file can disappear between the command invocation and this read
      vscode.window.showErrorMessage(
        `Ghostscript validation skipped: cannot read ${documentUri.fsPath} (${error instanceof Error ? error.message : String(error)})`
      )
      return
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri)
    const workspaceRoot = workspaceFolder?.uri.fsPath
    const cwd = workspaceRoot ?? path.dirname(documentUri.fsPath)

    const gsConfigPath = vscode.workspace.getConfiguration('postscript').get<string>('interpreter.executable')
    const resolution = resolveGhostscript({ configPath: gsConfigPath })
    const gsPath = resolution.path
    if (!gsPath) {
      vscode.window.showErrorMessage('Ghostscript executable not found. Configure postscript.interpreter.executable.')
      return
    }

    const tmpFile = path.join(os.tmpdir(), `ps-validate-${process.pid}-${Date.now()}.ps`)
    const version = document?.version ?? -1

    for (const uri of reportedUris) collection.set(vscode.Uri.parse(uri), [])
    reportedUris.clear()

    try {
      const target = await resolveValidationStream(documentUri.fsPath, text, workspaceRoot)
      fs.writeFileSync(tmpFile, target.text + RESIDUE_PROBE, 'utf8')
      // `-c` installs the structured error handler before the snapshot runs;
      // `-f` closes the `-c` argument list so the temp file stays a file
      // argument (gs would otherwise swallow it into the -c source). The
      // trailing `-c` is a completion sentinel: `-c` arguments run in order,
      // so it only executes when the program reached the end of the file.
      //
      // Both markers carry a per-run nonce: the validated program shares the
      // output stream, so a literal `===GS-ERROR===` printed by user code must
      // not be mistaken for the handler's report.
      const nonce = makeRunNonce()
      const result = await runGs(
        gsPath,
        [
          '-q', '-dNODISPLAY', '-dBATCH', '-dNOPAUSE',
          '-c', buildGsErrorHandler(nonce),
          '-f', tmpFile,
          '-c', buildDoneSentinel(nonce)
        ],
        cwd
      )
      const combined = `${result.stdout}\n${result.stderr}`
      const outcome = classifyGsRun({ exitCode: result.code, output: combined, nonce })

      if (outcome.kind === 'clean') {
        const residue = outcome.residue
        send('postscript/gsVerified', { uri: documentUri.toString(), version, clean: true, residue })
        collection.set(documentUri, [])
        const residueNote = residue !== undefined && residue > 0 ? ` (mark residue: ${residue})` : ''
        const unitNote = target.fragments ? ` [build unit: ${target.unitFiles.length} files]` : ''
        void vscode.window.setStatusBarMessage(`PostScript: Ghostscript validation passed${unitNote}${residueNote}`, 4000)
        outputChannel.appendLine(`[${new Date().toLocaleString()}] Ghostscript validation passed${unitNote}${residueNote}: ${documentUri.fsPath}`)
        return
      }

      if (outcome.kind === 'incomplete') {
        // exit 0 without the sentinel: the program called `quit` (or consumed
        // the rest of the input another way) before reaching its end. The
        // bytes after that point were never interpreted, so this run must not
        // count as "gs-verified" — the L0 warnings stay.
        send('postscript/gsVerified', { uri: documentUri.toString(), version, clean: false })
        collection.set(documentUri, [])
        void vscode.window.setStatusBarMessage(
          'PostScript: Ghostscript stopped before the end of the file (quit) — structural checks kept',
          4000
        )
        outputChannel.appendLine(
          `[${new Date().toLocaleString()}] Ghostscript validation incomplete (program ended early, likely quit): ${documentUri.fsPath}`
        )
        return
      }

      // Attribution: the structured report first, the human-readable block
      // second. Both can be missing when the program replaced
      // `errordict /handleerror`, which no hook on the PostScript side can
      // prevent — the failure is then reported without a position instead of
      // inventing one.
      let info: GsErrorInfo | undefined
      let report: GsErrorReport | undefined
      if (outcome.kind === 'error') {
        report = outcome.report
        info = outcome.report
      } else if (outcome.kind === 'error-text') {
        info = outcome.info
      }

      if (!info) {
        send('postscript/gsVerified', { uri: documentUri.toString(), version, clean: false })
        const endOffset = text.length
        const at = offsetToPosition(text, endOffset)
        const crash = outcome.kind === 'crash'
        const detail = crash ? outcome.detail : `exit code ${outcome.kind === 'error-unattributed' ? outcome.exitCode : result.code}`
        const diagnostics: vscode.Diagnostic[] = [{
          severity: vscode.DiagnosticSeverity.Error,
          range: crash ? new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)) : new vscode.Range(at, at),
          message: crash
            ? `Ghostscript: the interpreter itself failed (${detail}) — no PostScript error was reported; a common cause is redefining $error, which breaks gs's own error machinery`
            : `Ghostscript: validation failed (${detail}) but no error position was reported — the program replaced errordict /handleerror or an error handler returned without reporting`,
          source: 'postscript',
          code: 'PS013'
        }]
        collection.set(documentUri, diagnostics)
        reportedUris.add(documentUri.toString())
        outputChannel.appendLine(
          `[${new Date().toLocaleString()}] Ghostscript validation failed without attribution (${detail}); ` +
          `hook=${crash ? 'interpreter' : 'suppressed'}: ${documentUri.fsPath}`
        )
        return
      }

      const gsPosition = info.position ?? 0
      // gs position is 1-based and points AT the terminating whitespace
      // following the offending token (verified gs 10.08: "foo pop\n" with
      // foo at byte 0 reports position 4 = the space, 1-based). Convert the
      // 0-based byte index pos-1 to a char offset; the token's exclusive end
      // coincides with that whitespace char for single-char whitespace.
      const charOffset = gsPosition > 0 ? byteOffsetToCharOffset(target.text, gsPosition - 1) : 0

      let ownerPath = documentUri.fsPath
      let localOffset = charOffset
      if (target.fragments) {
        const located = locateFragmentOffset(target.fragments, charOffset)
        if (located) {
          ownerPath = located.file
          localOffset = located.localOffset
        }
      }

      const isDependency = ownerPath !== documentUri.fsPath
      const ownerText = isDependency
        ? (target.fragments?.find(f => f.file === ownerPath)?.text ?? '')
        : text
      const startPos = offsetToPosition(ownerText, Math.max(0, localOffset - 1))
      const endPos = offsetToPosition(ownerText, Math.max(1, localOffset))
      const ownerUri = isDependency ? vscode.Uri.file(ownerPath) : documentUri

      const name = info.errorname ? `/${info.errorname}` : 'unknown error'
      const commandHint = info.command ? ` in ${info.command}` : ''
      const where = isDependency ? ` — reported in ${path.basename(ownerPath)}` : ''
      const stackNote = report?.depth !== undefined && report.depth > 0
        ? `; ${report.depth} operand(s) on stack`
        : ''
      const diagnostics: vscode.Diagnostic[] = [{
        severity: vscode.DiagnosticSeverity.Error,
        range: new vscode.Range(startPos, endPos),
        message: `Ghostscript: ${name}${commandHint} (error position: end of token${stackNote})${where}`,
        source: 'postscript',
        code: 'PS013'
      }]
      collection.set(ownerUri, diagnostics)
      reportedUris.add(ownerUri.toString())
      send('postscript/gsVerified', { uri: documentUri.toString(), version, clean: false })
      outputChannel.appendLine(
        `[${new Date().toLocaleString()}] Ghostscript validation failed: ${name}${commandHint} @ byte ${info.position ?? '?'}` +
        `${report?.errorname ? ' (via $error handler)' : ''}${target.fragments ? ` in ${ownerPath}` : ''}`
      )
    } catch (error) {
      // Reached when gs cannot be spawned, when the 20 s timeout killed it, or
      // when the snapshot could not be written. None of these is a PostScript
      // verdict, so no diagnostic is produced and the reason is spoken out
      // instead of surfacing as an unhandled command rejection.
      const detail = error instanceof Error ? error.message : String(error)
      const timedOut = !!error && (error as any).killed === true
      const reason = timedOut ? 'Ghostscript timed out (20 s)' : `Ghostscript validation could not run: ${detail}`
      vscode.window.showErrorMessage(reason)
      outputChannel.appendLine(`[${new Date().toLocaleString()}] ${reason}: ${documentUri.fsPath}`)
    } finally {
      try {
        fs.unlinkSync(tmpFile)
      } catch {
        // best effort
      }
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('postscriptsnippets.validateWithGhostscript', validate)
  )
}
