import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { normalizePath, resolveGhostscript } from './ghostscriptHelper'

const PROJECT_CONFIG_FILENAME = 'postscript.config.json'

interface DependencyEntry {
  file: string
  inputs: string[]
  buildArgs?: string[]
  executable?: string
  workingDirectory?: string
}

interface PostscriptProjectConfig {
  dependencies?: DependencyEntry[]
  workspaceDependencies?: string[]
  globalDependencies?: string[]
}

function resolveConfigRelative(value: string, configDir: string): string {
  if (path.isAbsolute(value)) {
    return value
  }
  return path.join(configDir, value)
}

function matchesCompileFile(configFile: string, currentFilePath: string, configDir: string, workspaceRoot: string): boolean {
  const normalizedCurrent = normalizePath(currentFilePath)
  const candidatePaths = [
    normalizePath(path.resolve(configDir, configFile)),
    normalizePath(path.resolve(workspaceRoot, configFile)),
    normalizePath(configFile),
    normalizePath(path.basename(configFile))
  ]

  return candidatePaths.some(candidate => candidate === normalizedCurrent)
}

export async function compilePostscript(resource?: vscode.Uri): Promise<void> {
  const documentUri = resource ?? vscode.window.activeTextEditor?.document.uri
  if (!documentUri || documentUri.scheme !== 'file') {
    vscode.window.showErrorMessage('No active PostScript file to compile.')
    return
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri)
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('Cannot find workspace folder for the current file.')
    return
  }

  const workspaceRoot = workspaceFolder.uri.fsPath
  const configPath = path.join(workspaceRoot, PROJECT_CONFIG_FILENAME)
  const configDir = path.dirname(configPath)

  if (!fs.existsSync(configPath)) {
    vscode.window.showErrorMessage(`Cannot find ${PROJECT_CONFIG_FILENAME} in workspace root.`)
    return
  }

  let projectConfig: PostscriptProjectConfig
  try {
    const raw = await fs.promises.readFile(configPath, 'utf8')
    projectConfig = JSON.parse(raw) as PostscriptProjectConfig
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to read ${PROJECT_CONFIG_FILENAME}: ${error}`)
    return
  }

  const currentFilePath = documentUri.fsPath
  const dependencyEntry = (projectConfig.dependencies || []).find(entry =>
    entry.file && matchesCompileFile(entry.file, currentFilePath, configDir, workspaceRoot)
  )

  // If file isn't declared in postscript.config.json, fall back to sensible defaults
  // and ensure -dBATCH is used as a default argument.
  const gsConfigPath = vscode.workspace.getConfiguration('postscript').get<string>('interpreter.executable')
  const explicitPath = dependencyEntry && dependencyEntry.executable
    ? resolveConfigRelative(dependencyEntry.executable, configDir)
    : undefined
  const result = resolveGhostscript({
    explicitPath,
    configPath: gsConfigPath
  })
  const ghostscriptPath = result.path || 'gs'

  const cwd = dependencyEntry && dependencyEntry.workingDirectory
    ? resolveConfigRelative(dependencyEntry.workingDirectory, configDir)
    : workspaceRoot

  const buildArgs = dependencyEntry ? (dependencyEntry.buildArgs ?? []) : []
  const args = [...buildArgs]
  if (!args.some(arg => arg.trim().toUpperCase() === '-DBATCH')) {
    args.push('-dBATCH')
  }

  if (projectConfig.globalDependencies) {
    for (const depFile of projectConfig.globalDependencies) {
      const resolvedDep = resolveConfigRelative(depFile, configDir)
      args.push(resolvedDep)
    }
  }

  if (projectConfig.workspaceDependencies) {
    for (const depFile of projectConfig.workspaceDependencies) {
      const resolvedDep = resolveConfigRelative(depFile, configDir)
      args.push(resolvedDep)
    }
  }

  if (dependencyEntry && dependencyEntry.inputs) {
    for (const inputFile of dependencyEntry.inputs) {
      const resolvedInput = resolveConfigRelative(inputFile, configDir)
      args.push(resolvedInput)
    }
  }

  args.push(currentFilePath)

  // Run in VS Code integrated terminal (reuse if exists)
  const quoteIfNeeded = (s: string) => {
    if (!s) return '""'
    if (s.includes(' ') || s.includes('"') || s.includes("'")) {
      return `"${s.replace(/"/g, '\\"')}"`
    }
    return s
  }

  const cmdParts = [quoteIfNeeded(ghostscriptPath), ...args.map(quoteIfNeeded)]
  const cmd = cmdParts.join(' ')

  let terminal = vscode.window.terminals.find(t => t.name === 'PostScript Compiler')
  if (!terminal) {
    terminal = vscode.window.createTerminal({ name: 'PostScript Compiler', cwd })
  }
  terminal.show(true)
  terminal.sendText(cmd, true)
}
