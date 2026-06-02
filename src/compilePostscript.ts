import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { resolveGhostscript } from './ghostscriptHelper'
import {
  PROJECT_CONFIG_FILENAME,
  getProjectConfig,
  matchesCompileFile,
  resolveConfigPath,
  PostscriptProjectConfig
} from './language-server/configUtils'

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
  const hasConfigFile = fs.existsSync(configPath)

  const { rawConfig, configDir } = await getProjectConfig(workspaceRoot)
  const projectConfig = rawConfig as PostscriptProjectConfig

  const currentFilePath = documentUri.fsPath
  const dependencyEntry = hasConfigFile && projectConfig.dependencies
    ? projectConfig.dependencies.find(entry =>
        entry.file && matchesCompileFile(entry.file, currentFilePath, configDir || workspaceRoot, workspaceRoot)
      )
    : undefined

  const gsConfigPath = vscode.workspace.getConfiguration('postscript').get<string>('interpreter.executable')
  const explicitPath = dependencyEntry && dependencyEntry.executable
    ? resolveConfigPath(dependencyEntry.executable, configDir, currentFilePath, workspaceRoot)
    : undefined
  const result = resolveGhostscript({
    explicitPath,
    configPath: gsConfigPath
  })
  const ghostscriptPath = result.path || 'gs'

  const cwd = dependencyEntry && dependencyEntry.workingDirectory
    ? resolveConfigPath(dependencyEntry.workingDirectory, configDir, currentFilePath, workspaceRoot)
    : workspaceRoot

  const buildArgs = dependencyEntry ? (dependencyEntry.buildArgs ?? []) : []
  const args = [...buildArgs]
  if (!args.some(arg => arg.trim().toUpperCase() === '-DBATCH')) {
    args.push('-dBATCH')
  }

  if (projectConfig.globalDependencies) {
    for (const depFile of projectConfig.globalDependencies) {
      const resolvedDep = resolveConfigPath(depFile, configDir, currentFilePath, workspaceRoot)
      args.push(resolvedDep)
    }
  }

  if (projectConfig.workspaceDependencies) {
    for (const depFile of projectConfig.workspaceDependencies) {
      const resolvedDep = resolveConfigPath(depFile, configDir, currentFilePath, workspaceRoot)
      args.push(resolvedDep)
    }
  }

  if (dependencyEntry && dependencyEntry.inputs) {
    for (const inputFile of dependencyEntry.inputs) {
      const resolvedInput = resolveConfigPath(inputFile, configDir, currentFilePath, workspaceRoot)
      args.push(resolvedInput)
    }
  }

  args.push(currentFilePath)

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