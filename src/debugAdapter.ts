import * as debugadapter from '@vscode/debugadapter'
import { DebugProtocol } from '@vscode/debugprotocol'
import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import * as psOutputParsers from './psOutputParsers'

const gs_dbg_start = /GS_DBG_START:(\d+)/
const gs_dbg_end = /GS_DBG_END:(\d+)/
const gs_eval_end = /GS_EVAL_END:(\d+)/
class GhostscriptDebugSession extends debugadapter.DebugSession {
  private gsProcesses?: ChildProcessWithoutNullStreams
  private programPath?: string
  private breakpoints: DebugProtocol.Breakpoint[] = []
  private units: string[] = []
  private unitIndex = 0
  private evalCounter = 1
  private varRefCounter = 1
  private varRefs: Map<number, psOutputParsers.VarRefInfo> = new Map()

  public constructor() {
    super()
    this.setDebuggerLinesStartAt1(true)
    this.setDebuggerColumnsStartAt1(true)
  }

  private normalizePath(p?: string): string | undefined {
    if (!p) return undefined
    try {
      let p2 = ''
      if (p.startsWith('file://')) p2 = fileURLToPath(p)
      else p2 = path.normalize(path.resolve(p))
      if (process.platform === 'win32') {
        p2 = p2.toLocaleLowerCase()
      }
      return p2
    } catch (e) {
      try {
        // fallback simple cleanup
        return path.normalize(p.replace(/^file:\/\//, ''))
      } catch { return p }
    }
  }

  protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
    response.body = response.body || {}
    response.body.supportsConfigurationDoneRequest = false
    response.body.supportsStepInTargetsRequest = false
    response.body.supportsEvaluateForHovers = false
    // response.body.supportsClipboardContext = false
    // Advertise that we support terminate (stop) requests
    response.body.supportsTerminateRequest = true
    this.sendResponse(response)
    this.sendEvent(new debugadapter.InitializedEvent())
  }
  protected customRequest(command: string, response: DebugProtocol.Response, args: any, request?: DebugProtocol.Request): void {
    this.sendResponse(response)
  }
  protected launchRequest(response: DebugProtocol.LaunchResponse, args: any): void {
    const program: string | undefined = args.program
    if (!program) {
      this.sendEvent(new debugadapter.OutputEvent('No program provided in launch configuration\n', 'stderr'))
      this.sendResponse(response)
      this.sendEvent(new debugadapter.TerminatedEvent())
      return
    }
    const ghostscriptPath = args.ghostscriptPath || (process.platform === 'win32' ? 'gswin64c' : 'gs')
    // normalize program path for consistent breakpoint matching
    this.programPath = this.normalizePath(program) || program
    const gsArgs = ['-q', '-sOutputFile=*', '-dNODISPLAY', '-']

    try {
      this.gsProcesses = spawn(ghostscriptPath, gsArgs, { cwd: path.dirname(program), shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err: any) {
      this.sendEvent(new debugadapter.OutputEvent(`Failed to start Ghostscript: ${err.message || err}\n`, 'stderr'))
      this.sendResponse(response)
      this.sendEvent(new debugadapter.TerminatedEvent())
      return
    }

    // Tokenize program into per-line units (line-based stepping)
    // IMPORTANT: include empty/comment lines so unit.line matches file line numbers exactly
    try {
      const txt = fs.readFileSync(this.programPath, 'utf8')
      const lines = txt.split(/\r?\n/)
      this.units.push(...lines)
    } catch (err: any) {
      this.sendEvent(new debugadapter.OutputEvent(`Failed to read program: ${err.message}\n`, 'stderr'))
    }

    // Attempt to load debug helper PS scripts into GS stdin so helper functions are available
    const helperCandidates = [
      path.join(__dirname, '..', 'ps', 'debugger.ps')
    ]
    for (const hp of helperCandidates) {
      if (fs.existsSync(hp)) {
        const helperText = fs.readFileSync(hp, 'utf8')
        try {
          this.gsProcesses!.stdin.write(helperText + '\n')
        } catch (e: any) {
          this.sendEvent(new debugadapter.OutputEvent(`[PostScript-Debug] failed to load debugger helper ${hp}: ${e.message || e}\n`, 'stderr'))
        }
      }
    }

    let buffer: string[] = []
    this.gsProcesses.stdout.on('data', chunk => {
      const text = chunk.toString() as string
      // detect markers
      // unit markers
      const dbgEndMatch = text.match(gs_dbg_end)
      if (dbgEndMatch) {
        this.emit(dbgEndMatch[0])
        const parts = text.split(dbgEndMatch[0], 2)
        buffer.push(parts[0])
        this.sendEvent(new debugadapter.OutputEvent(buffer.join('').split(`GS_DBG_START:${dbgEndMatch[1]}`, 2)[1], 'stdout'))
        buffer = [parts[1]]
      }

      const dbgStartMatch = text.match(gs_dbg_start)
      if (dbgStartMatch) {
        const parts = text.split(dbgStartMatch[0], 2)
        buffer = [parts[1]]
      }

      // eval markers
      const evalEndMatch = text.match(gs_eval_end)
      if (evalEndMatch) {
        const parts = text.split(evalEndMatch[0], 2)
        buffer.push(parts[0])
        const the_eval = buffer.join('')
        this.emit(evalEndMatch[0], the_eval)
        buffer = [parts[1]]
      } else buffer.push(text)
    })

    this.gsProcesses.stderr.on('data', chunk => {
      this.sendEvent(new debugadapter.OutputEvent(`Ghostscript error: ${chunk.toString()}\n`, 'stderr'))
    })
    this.gsProcesses.on('error', err => {
      this.sendEvent(new debugadapter.OutputEvent(`Ghostscript error: ${err.message}\n`, 'stderr'))
      this.sendEvent(new debugadapter.TerminatedEvent())
    })

    this.gsProcesses.on('exit', (code, signal) => {
      this.sendEvent(new debugadapter.OutputEvent(`Ghostscript exited with code ${code} signal ${signal}\n`, 'console'))
      // process exit: notify terminated
      this.sendEvent(new debugadapter.TerminatedEvent())
    })

    // Respond to launch request to finish initialization so the client can continue
    this.sendResponse(response)

    // stopOnEntry is true (default), emit a stopped event so the UI can show call stack
    this.sendEvent(new debugadapter.StoppedEvent('entry', 1))
  }

  protected terminateRequest(response: DebugProtocol.TerminateResponse, args: any): void {

    if (this.gsProcesses && !this.gsProcesses.killed) {
      try { this.gsProcesses.kill() } catch { }
    }
    this.sendResponse(response)
    this.sendEvent(new debugadapter.TerminatedEvent())
  }

  protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: any): void {

    if (this.gsProcesses && !this.gsProcesses.killed) {
      try { this.gsProcesses.kill() } catch { }
    }
    this.sendResponse(response)
  }

  protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
    // single-threaded model
    response.body = { threads: [new debugadapter.Thread(1, 'Main Thread')] }
    this.sendResponse(response)
  }

  protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
    const frames: DebugProtocol.StackFrame[] = []
    if (this.programPath) {
      frames.push({ id: 1, name: 'Ghostscript', source: { path: this.programPath }, line: this.unitIndex + 1, column: 1 })
      response.body = { stackFrames: frames, totalFrames: 1 }
    } else {
      response.body = { stackFrames: [], totalFrames: 0 }
    }
    this.sendResponse(response)
  }

  protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {

    // Provide operand stack, dictionary stack, and exec stack as scopes in REPL mode when stopped
    // generate var refs
    const oRef = this.varRefCounter++
    this.varRefs.set(oRef, { type: 'dicttype', name: '/ostack', router: [] })
    const dRef = this.varRefCounter++
    this.varRefs.set(dRef, { type: 'dicttype', name: '/dstack', router: [] })
    const eRef = this.varRefCounter++
    this.varRefs.set(eRef, { type: 'dicttype', name: '/estack', router: [] })

    const scopes: DebugProtocol.Scope[] = [
      { name: 'Operand Stack', variablesReference: oRef, expensive: true },
      { name: 'Dictionary Stack', variablesReference: dRef, expensive: true },
      { name: 'Execution Stack', variablesReference: eRef, expensive: true }
    ]
    response.body = { scopes }
    this.sendResponse(response)
  }

  protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {

    const ref = args.variablesReference
    const entry = this.varRefs.get(ref)
    if (!entry) {
      response.body = { variables: [] }
      this.sendResponse(response)
      return
    }

    // default behavior: prefer route-based entries when routePsLiteral exists
    const router: string[] = []
    if (entry.router) router.push(...entry.router, entry.name)
    else router.push(entry.name)
    this.sendEvent(new debugadapter.OutputEvent(`[PostScript-Debug] variablesRequest for [${router.join(' ')}]\n`, 'console'))
    const alloc: psOutputParsers.VarRefAllocator = (info) => {
      for (const entry of this.varRefs) {
        if (info.name === entry[1].name && psOutputParsers.arraysEqual(entry[1].router, info.router))
          return entry[0]
      }
      const r = this.varRefCounter++
      this.varRefs.set(r, info)
      return r
    }
    const eval_event = this.gs_traverse_route(router)
    this.once(eval_event, text => {
      response.body = {
        variables:
          psOutputParsers.pickVariableWithRoute(text, router, alloc)
      }
      this.sendResponse(response)
    })
  }

  protected continueRequest(response: DebugProtocol.ContinueResponse, args: any): void {
    const p = this.normalizePath(this.programPath)
    const bp = this.breakpoints.filter(v => {
      const p2 = this.normalizePath(v.source?.path)
      return v.source?.name === p || p2 === p
    }).find(v => {
      return v.line && v.line > (this.unitIndex + 1)
    })
    if (bp) {
      if (bp.line !== undefined) {
        const dbg_event = this.sendUnit(this.units.slice(this.unitIndex, bp.line - 1).join('\n'))
        this.once(dbg_event, () => {
          if (bp.line)
            this.unitIndex = bp.line - 1
          this.sendEvent(new debugadapter.StoppedEvent('breakpoint', 1))
          this.sendResponse(response)
        })
      }
    } else {
      this.once(this.sendUnit(this.units.slice(this.unitIndex).join('\n')), () => {
        this.sendEvent(new debugadapter.TerminatedEvent())
        this.sendResponse(response)
      })
    }
  }

  protected nextRequest(response: DebugProtocol.NextResponse, args: any): void {
    if (this.unitIndex >= this.units.length) {
      this.sendResponse(response)
      this.sendEvent(new debugadapter.TerminatedEvent())
      return
    }
    const u = this.units[this.unitIndex]
    this.once(this.sendUnit(u), () => {
      this.unitIndex++
      this.sendResponse(response)
      this.sendEvent(new debugadapter.StoppedEvent('step', args.threadId))
    })

  }

  protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
    switch (args.context) {
      case 'watch':
        {
          const item = [...this.varRefs.entries()].find(v => {
            return `[${[...v[1].router, v[1].name].join(' ')}]` === args.expression
          })
          if (item) {
            response.body = {
              result: (item[1].value ? item[1].value : ''), variablesReference: item[0]
            }
          }
        }
        break
    }
    this.sendResponse(response)
  }

  private sendEval(expr: string) {
    if (!this.gsProcesses || !this.gsProcesses.stdin) throw 'Ghostscript not running'
    const id = this.evalCounter++
    const startMarker = `GS_EVAL_START:${id}`
    const endMarker = `GS_EVAL_END:${id}`
    // Use print markers and then the expression, then end marker
    // Ensure expression ends with newline
    const wrapper = `(${startMarker}) print flush\n${expr}\n(${endMarker}) print flush\n`
    this.gsProcesses.stdin.write(wrapper)
    return endMarker
  }

  private gs_traverse_route(parentRoute: string[]) {
    return this.sendEval(`[${parentRoute.join(' ')}] gs_traverse_route`)
  }

  protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
    this.breakpoints = []
    const breakpoints = this.breakpoints
    args.breakpoints?.forEach(v => {
      breakpoints.push({ verified: true, source: args.source, line: v.line })
    })
    response.body = { breakpoints }
    this.sendResponse(response)
  }

  private sendUnit(unit: string) {
    if (!this.gsProcesses || !this.gsProcesses.stdin) throw 'Ghostscript not running'
    const startMarker = `GS_DBG_START:${this.unitIndex}`
    const endMarker = `GS_DBG_END:${this.unitIndex}`
    const wrapper = `(${startMarker}) print flush\n${unit}\n(${endMarker}) print flush\n`
    this.gsProcesses.stdin.write(wrapper)
    return endMarker
  }
}

// Run the session
debugadapter.DebugSession.run(GhostscriptDebugSession)
