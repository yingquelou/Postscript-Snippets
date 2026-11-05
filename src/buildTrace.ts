import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { execFile } from 'child_process'
import { resolveGhostscript } from './ghostscriptHelper'
import { getProjectConfigForFile, resolvePreloadConfig, matchesCompileFile } from './language-server/configUtils'
import { escapePsString, parseTraceStderr, parseGsErrorReport, buildGsErrorHandler, BuildTrace } from './gsParsers'

/**
 * Build trace generator (docs/design/build-trace.md).
 *
 * The project model is derived from a REAL build, not a hand-written config:
 * the build is replayed with top-level files passed as `-c "(file) run"` and
 * a userdict-level shadow `run` logging `===TRACE-RUN===<file>` to stderr.
 * stderr line order is the true execution order (nested runs included).
 *
 * Known semantic deltas (documented): replay uses `run` where a real build
 * may use `runlibfile` (search-path behavior differs slightly), and the trace
 * records the execution order of THIS configuration — conditionally loaded
 * files need one trace per configuration.
 */

function runGs(gsPath: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    execFile(gsPath, args, { cwd, timeout: 60000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = (error as any)?.code
      if (error && typeof code !== 'number') {
        reject(error)
        return
      }
      resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code: typeof code === 'number' ? code : 0 })
    })
  })
}

export function createBuildTraceRunner(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
  return async (resource?: vscode.Uri): Promise<void> => {
    const documentUri = resource ?? vscode.window.activeTextEditor?.document.uri
    if (!documentUri || documentUri.scheme !== 'file') {
      vscode.window.showErrorMessage('No active PostScript file to trace.')
      return
    }
    const currentFilePath = documentUri.fsPath
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri)
    const workspaceRoot = workspaceFolder?.uri.fsPath
    if (!workspaceRoot) {
      vscode.window.showErrorMessage('Cannot find workspace folder for the current file.')
      return
    }

    // analysis unit = build unit: replay the same file sequence the compile
    // command would use (config next to the file wins, workspace root fallback)
    const { rawConfig, configDir, configPath } = await getProjectConfigForFile(currentFilePath, workspaceRoot)
    let mainFiles: string[] = [currentFilePath]
    let cwd = workspaceRoot
    if (configPath && configDir) {
      const declared = (rawConfig.dependencies ?? []).find(
        entry => entry.file && matchesCompileFile(entry.file, currentFilePath, configDir, workspaceRoot)
      )
      const preload = resolvePreloadConfig(rawConfig, currentFilePath, configDir, workspaceRoot)
      mainFiles = [...preload.globalLevel, ...preload.workspaceLevel, ...preload.fileLevel, currentFilePath]
      if (declared?.workingDirectory) {
        cwd = path.resolve(configDir, declared.workingDirectory)
      }
    }

    const gsConfigPath = vscode.workspace.getConfiguration('postscript').get<string>('interpreter.executable')
    const resolution = resolveGhostscript({ configPath: gsConfigPath })
    const gsPath = resolution.path
    if (!gsPath) {
      vscode.window.showErrorMessage('Ghostscript executable not found. Configure postscript.interpreter.executable.')
      return
    }

    // SAFER must be disabled: replayed files are opened via run from -c
    // strings, and --permit-file-read only matches exact open-time paths
    const preamblePath = path.join(context.extensionPath, 'ps', 'build-trace-preamble.ps')
    if (!fs.existsSync(preamblePath)) {
      // packaging regression guard: ps/*.ps ships with the extension
      vscode.window.showErrorMessage(`Build trace preamble is missing (${preamblePath}). Reinstall the extension.`)
      return
    }
    const args: string[] = [
      '-q', '-dNODISPLAY', '-dBATCH', '-dNOPAUSE', '-dNOSAFER',
      // structured error report (`-f` closes the -c argument list)
      '-c', buildGsErrorHandler(), '-f', preamblePath
    ]
    for (const file of mainFiles) {
      args.push('-c', `(${escapePsString(file)}) run`)
    }
    args.push('-c', 'quit')

    outputChannel.appendLine(`[${new Date().toLocaleString()}] Tracing build (${mainFiles.length} top-level file(s))…`)

    const trace: BuildTrace = {
      version: 1,
      generator: 'Postscript-Snippets',
      gsExitCode: 0,
      mainFiles,
      orderedFiles: []
    }
    const outDir = path.join(workspaceRoot, '.postscript')
    const outPath = path.join(outDir, 'build-trace.json')

    try {
      const result = await runGs(gsPath, args, cwd)
      trace.gsExitCode = result.code
      trace.orderedFiles = parseTraceStderr(result.stderr)

      fs.mkdirSync(outDir, { recursive: true })
      fs.writeFileSync(outPath, JSON.stringify(trace, null, 2), 'utf8')

      if (trace.gsExitCode !== 0) {
        const report = parseGsErrorReport(`${result.stdout}\n${result.stderr}`)
        const detail = report?.errorname
          ? ` /${report.errorname}${report.command ? ` in ${report.command}` : ''}${report.position ? ` @ byte ${report.position}` : ''}`
          : ''
        outputChannel.appendLine(`Note: gs exited with code ${trace.gsExitCode}; the trace is partial.${detail ? ` Failed at${detail}.` : ''}`)
      }
    } catch (error) {
      // spawn failure, the 60 s timeout, or an unwritable workspace: none of
      // these is a build verdict, so nothing is written and nothing is faked
      const detail = error instanceof Error ? error.message : String(error)
      const timedOut = !!error && (error as any).killed === true
      const reason = timedOut
        ? 'Build trace aborted: Ghostscript timed out (60 s)'
        : `Build trace failed: ${detail}`
      vscode.window.showErrorMessage(reason)
      outputChannel.appendLine(`[${new Date().toLocaleString()}] ${reason}`)
      return
    }

    const orderedFiles = trace.orderedFiles
    outputChannel.appendLine(`Execution order (${orderedFiles.length} file(s)):`)
    for (const f of orderedFiles) {
      outputChannel.appendLine(`  ${f}`)
    }

    const action = await vscode.window.showInformationMessage(
      `Build trace written: ${orderedFiles.length} file(s) in execution order.`,
      'Open build-trace.json'
    )
    if (action === 'Open build-trace.json') {
      const doc = await vscode.workspace.openTextDocument(outPath)
      await vscode.window.showTextDocument(doc)
    }
  }
}
