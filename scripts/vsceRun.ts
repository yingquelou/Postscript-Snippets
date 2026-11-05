import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { restoreManifest } from './manifest.js'

/**
 * Run `vsce` and always restore package.json afterwards.
 *
 * Why a wrapper instead of npm's `postpackage` hook: npm does not run
 * `post<script>` when the main script fails, and a failing `vsce package`
 * (bad output path, unreadable file, network for publish) is exactly the case
 * where the injected `contributes.snippets` field must not be left behind.
 * Ctrl-C has the same problem. Cleaning inside a child-process wrapper covers
 * success, failure, and interruption with one code path.
 */

const rootDir = path.join(__dirname, '..')
const vsceArgs = process.argv.slice(2)

function cleanup(): void {
  try {
    const result = restoreManifest()
    if (result.changed) {
      console.log(`package.json: ${result.reason}`)
    }
  } catch (error) {
    console.error('warning: failed to restore package.json:', error)
  }
}

let finished = false
function finish(code: number): void {
  if (finished) return
  finished = true
  cleanup()
  process.exit(code)
}

process.on('SIGINT', () => finish(130))
process.on('SIGTERM', () => finish(143))
// last resort (e.g. an uncaught exception path that skips finish())
process.on('exit', () => {
  if (!finished) {
    finished = true
    cleanup()
  }
})

function resolveVsce(): { command: string; prefix: string[] } {
  // run the CLI entry with the current node binary: works identically on all
  // platforms and does not depend on node_modules/.bin being on PATH
  const entry = path.join(rootDir, 'node_modules', '@vscode', 'vsce', 'vsce')
  if (fs.existsSync(entry)) {
    return { command: process.execPath, prefix: [entry] }
  }
  const bin = path.join(
    rootDir,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'vsce.cmd' : 'vsce'
  )
  if (fs.existsSync(bin)) {
    return { command: bin, prefix: [] }
  }
  return { command: process.platform === 'win32' ? 'vsce.cmd' : 'vsce', prefix: [] }
}

const vsce = resolveVsce()
const child = spawn(vsce.command, [...vsce.prefix, ...vsceArgs], {
  cwd: rootDir,
  stdio: 'inherit'
})

child.on('error', error => {
  console.error('failed to run vsce:', error)
  finish(1)
})

child.on('exit', (code, signal) => {
  finish(signal ? 1 : code ?? 1)
})
