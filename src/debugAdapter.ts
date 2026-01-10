import * as debugadapter from '@vscode/debugadapter'
import { DebugProtocol } from '@vscode/debugprotocol'
import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import * as psOutputParsers from './psOutputParsers'
import { psParserHelper } from './postscriptParser'
import { CstWalker } from './cstWalker'

const ps_dbg = /PS_DBG_START\((\d+)\)([\s\S]*)PS_DBG_END\((\1)\)/
const ps_dbg_end = /PS_DBG_END\((\d+)\)/
const ps_eval = /PS_EVAL_START\((\d+)\)([\s\S]*)PS_EVAL_END\((\1)\)/
const ps_eval_end = /PS_EVAL_END\((\d+)\)/
class GhostscriptDebugSession extends debugadapter.DebugSession {
  private gsProcesses?: ChildProcessWithoutNullStreams
  private programPath?: string
  private programText: string = ''
  private breakpoints: DebugProtocol.Breakpoint[] = []
  private cstWalker?: CstWalker
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
    const gsArgs = ['-q', '-sOutputFile=*', '-sstderr=%stdout', '-dNODISPLAY', '-']

    try {
      this.gsProcesses = spawn(ghostscriptPath, gsArgs, { cwd: path.dirname(program), shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err: any) {
      this.sendEvent(new debugadapter.OutputEvent(`Failed to start Ghostscript: ${err.message || err}\n`, 'stderr'))
      this.sendResponse(response)
      this.sendEvent(new debugadapter.TerminatedEvent())
      return
    }

    // Parse program into syntax tree (token-based stepping)
    try {
      this.programText = fs.readFileSync(this.programPath, 'utf8')
      const { cst, errors, tokens } = psParserHelper(this.programText)
      if (errors.length > 0) {
        this.sendEvent(new debugadapter.OutputEvent(`Parse errors: ${errors.map(e => e.message).join(', ')}\n`, 'stderr'))
      }
      if (cst) {
        this.cstWalker = new CstWalker(cst, this.programText)
      } else {
        this.sendEvent(new debugadapter.OutputEvent(`Failed to parse program\n`, 'stderr'))
      }
    } catch (err: any) {
      this.sendEvent(new debugadapter.OutputEvent(`Failed to read/parse program: ${err.message}\n`, 'stderr'))
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
    let buffer = ''
    this.gsProcesses.stdout.on('data', chunk => {
      buffer = buffer.concat(chunk)
      // detect markers
      // unit markers
      const dbgEndMatch = buffer.match(ps_dbg_end)
      if (dbgEndMatch) {
        const dbgMatch = buffer.match(ps_dbg)
        buffer = ''
        if (dbgMatch) {
          const { message, rest } = psOutputParsers.ps_error(dbgMatch[2])
          if (rest) {
            this.sendEvent(new debugadapter.OutputEvent(rest + '\n', 'stdout'))
          }
          this.emit(dbgEndMatch[0], rest)
          if (message) {
            this.sendEvent(new debugadapter.StoppedEvent('exception', 1, message))
          }
        }
      }

      // eval markers
      const evalEndMatch = buffer.match(ps_eval_end)
      if (evalEndMatch) {
        const evalMatch = buffer.match(ps_eval)
        buffer = ''
        if (evalMatch) {
          this.emit(evalEndMatch[0], evalMatch[2])
        }
      }
    })

    this.gsProcesses.stderr.on('data', chunk => {
      this.sendEvent(new debugadapter.OutputEvent(`${chunk}`, 'stderr'))
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
    if (this.programPath && this.cstWalker) {
      const location = this.cstWalker.getCurrentLocation()
      if (location.startLine && location.startColumn) {
        frames.push({
          id: 1,
          name: 'Ghostscript',
          source: { path: this.programPath },
          line: location.startLine,
          column: location.startColumn
        })
      }
      if (frames.length > 0) {
        response.body = { stackFrames: frames, totalFrames: frames.length }
      } else {
        this.sendEvent(new debugadapter.TerminatedEvent())
      }
      this.sendResponse(response)
    }
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
    this.once(this.ps_traverse_route(router), text => {
      response.body = {
        variables:
          psOutputParsers.pickVariableWithRoute(text, router, alloc)
      }
      this.sendResponse(response)
    })
  }

  protected continueRequest(response: DebugProtocol.ContinueResponse, args: any): void {
    if (!this.cstWalker) {
      this.sendResponse(response)
      this.sendEvent(new debugadapter.TerminatedEvent())
      return
    }
    // TODO:The coordination between breakpoints, exceptions, and request responses is not handled properly here.

    const p = this.normalizePath(this.programPath)
    const bp = this.breakpoints.filter(v => {
      const p2 = this.normalizePath(v.source?.path)
      return v.source?.name === p || p2 === p
    }).find(v => {
      if (!v.line) return false
      const location = this.cstWalker!.getCurrentLocation()
      return location.startLine && v.line > location.startLine
    })
    if (bp && bp.line) {
      const buffer: string[] = []
      do {
        let location = this.cstWalker.getCurrentLocation()
        if (location.startLine && location.startLine < bp.line) {
          const text = this.cstWalker.stepIn()
          if (text) {
            buffer.push(text)
          } else {
            this.sendEvent(new debugadapter.TerminatedEvent())
            this.sendResponse(response)
            return
          }
        } else break
      } while (1)
      this.once(this.sendUnit(buffer.join(' ')), text => {
        this.sendResponse(response)
        this.sendEvent(new debugadapter.StoppedEvent('breakpoint', 1))
      })
    } else {
      let location = this.cstWalker.getCurrentLocation()
      this.once(this.sendUnit(this.programText.substring(location.startOffset)), text => {
        this.sendResponse(response)
        this.sendEvent(new debugadapter.TerminatedEvent())
      })
    }
  }

  protected nextRequest(response: DebugProtocol.NextResponse, args: any): void {
    const result = this.cstWalker?.next()
    if (result) {
      this.once(this.sendUnit(result), text => {
        this.sendResponse(response)
        this.sendEvent(new debugadapter.StoppedEvent('step', args.threadId))
      })
    } else {
      this.sendResponse(response)
      this.sendEvent(new debugadapter.TerminatedEvent())
    }
  }

  protected stepInRequest(response: DebugProtocol.StepInResponse, args: any): void {
    const result = this.cstWalker?.stepIn()
    if (result) {
      this.once(this.sendUnit(result), text => {
        this.sendResponse(response)
        this.sendEvent(new debugadapter.StoppedEvent('step', args.threadId))
      })
    } else {
      this.sendResponse(response)
      this.sendEvent(new debugadapter.TerminatedEvent())
    }
  }

  protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: any): void {
    const text = this.cstWalker?.stepOut()
    if (text) {
      this.once(this.sendUnit(text), () => {
        this.sendResponse(response)
        this.sendEvent(new debugadapter.StoppedEvent('step', args.threadId))
      })
    } else {
      this.sendResponse(response)
      this.sendEvent(new debugadapter.TerminatedEvent())
    }
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
        this.sendResponse(response)
        break
      case 'repl':
        this.once(
          this.sendEval(args.expression), text => {
            response.body = {
              result: text, variablesReference: 0
            }
            this.sendResponse(response)
          }
        )
        break
    }
  }
  /**
  * @returns {string} eval_eventName
  **/
  private sendEval(expr: string): string {
    if (!this.gsProcesses || !this.gsProcesses.stdin) throw 'Ghostscript not running'
    const id = this.evalCounter++
    const startMarker = `PS_EVAL_START(${id})`
    const endMarker = `PS_EVAL_END(${id})`
    // Use print markers and then the expression, then end marker
    // Ensure expression ends with newline
    this.gsProcesses.stdin.write(`(${startMarker}) print flush ${expr} (${endMarker}) print flush\n`)
    return endMarker
  }
  /**
   * @returns {string} eval_eventName
   **/
  private ps_traverse_route(parentRoute: string[]) {
    return this.sendEval(`[${parentRoute.join(' ')}] ps_traverse_route\n`)
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
  private unitCounter: number = 0
  /**
   * @returns {string} dbg_eventName
   */
  private sendUnit(unit: string): string {
    if (!this.gsProcesses) throw 'Ghostscript not running'
    const unitCounter = this.unitCounter++
    const startMarker = `PS_DBG_START(${unitCounter})`
    const endMarker = `PS_DBG_END(${unitCounter})`
    const wrapper = `(${startMarker}) print flush {${unit}} ps_print_if_error (${endMarker}) print flush\n`
    this.gsProcesses.stdin.write(wrapper)
    return endMarker
  }
}

// Run the session
debugadapter.DebugSession.run(GhostscriptDebugSession)
