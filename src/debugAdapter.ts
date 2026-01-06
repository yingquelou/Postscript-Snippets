import * as debugadapter from '@vscode/debugadapter'
import { DebugProtocol } from '@vscode/debugprotocol'
import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import * as psOutputParsers from './psOutputParsers'
import { psParserHelper } from './postscriptParser'
import { CstWalker } from './cstWalker'

const gs_dbg_start = /GS_DBG_START\((\d+)\)/
const gs_dbg_end = /GS_DBG_END\((\d+)\)/
const gs_eval_end = /GS_EVAL_END\((\d+)\)/
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

    // Parse program into syntax tree (token-based stepping)
    try {
      this.programText = fs.readFileSync(this.programPath, 'utf8')
      const { cst, errors } = psParserHelper(this.programText)
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
      const dbgEndMatch = buffer.match(gs_dbg_end)
      if (dbgEndMatch) {
        const parts = buffer.split(dbgEndMatch[0], 2)
        this.sendEvent(new debugadapter.OutputEvent(parts[0].replace(`GS_DBG_START(${dbgEndMatch[1]})`, ''), 'stdout'))
        buffer = parts[1]
        this.emit(dbgEndMatch[0])
      }

      const dbgStartMatch = buffer.match(gs_dbg_start)
      if (dbgStartMatch) {
        const parts = buffer.split(dbgStartMatch[0], 2)
        buffer = parts[1]
      }

      // eval markers
      const evalEndMatch = buffer.match(gs_eval_end)
      if (evalEndMatch) {
        const parts = buffer.split(evalEndMatch[0], 2)
        buffer = parts[1]
        this.emit(evalEndMatch[0], parts[0])
      }
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
    if (!this.cstWalker) {
      this.sendResponse(response)
      this.sendEvent(new debugadapter.TerminatedEvent())
      return
    }

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
        let location = this.cstWalker?.getCurrentLocation()
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
      this.once(this.sendUnit(buffer.join('')), () => {
        this.sendEvent(new debugadapter.StoppedEvent('breakpoint', 1))
        this.sendResponse(response)
      })
    } else {
      let location = this.cstWalker.getCurrentLocation()
      this.once(this.sendUnit(this.programText.substring(location.startOffset)), () => {
        this.sendEvent(new debugadapter.TerminatedEvent())
        this.sendResponse(response)
      })
    }
  }

  protected nextRequest(response: DebugProtocol.NextResponse, args: any): void {

    // Next: 处理一个兄弟节点。当到达当前所在子树的最后兄弟节点，还欲继续Next时，效果与StepOut相同
    const result = this.cstWalker?.next()
    if (result) {
      this.once(this.sendUnit(result), () => {
        this.sendResponse(response)
        this.sendEvent(new debugadapter.StoppedEvent('step', args.threadId))
      })
    } else {
      // 已到达程序末尾
      this.sendResponse(response)
      this.sendEvent(new debugadapter.TerminatedEvent())
    }
  }

  protected stepInRequest(response: DebugProtocol.StepInResponse, args: any): void {
    const text = this.cstWalker?.stepIn()
    if (text) {
      // 成功移动到子节点，停止等待下一次步进
      this.once(this.sendUnit(text), () => {
        this.sendResponse(response)
        this.sendEvent(new debugadapter.StoppedEvent('step', args.threadId))
      })
    } else {
      // 无法移动（已到达程序末尾）
      this.sendResponse(response)
      this.sendEvent(new debugadapter.OutputEvent('stepInRequest', 'console'))
      this.sendEvent(new debugadapter.TerminatedEvent())
    }

    // StepIn: 进入节点的子树处理。不存在子节点时,效果与Next相同
    // 对于字典和数组，如果有子节点：
    //   1. 先发送开始标记（<< 或 [）给解释器
    //   2. 然后移动到第一个子节点
    // 对于过程或其他没有子节点的节点，stepIn() 会执行 next()

    // 先检查是否有子节点可以进入
  }

  protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: any): void {
    const text = this.cstWalker?.stepOut()
    if (text) {
      // 成功移动到子节点，等待下一次步进
      this.once(this.sendUnit(text), () => {
        this.sendResponse(response)
        this.sendEvent(new debugadapter.StoppedEvent('step', args.threadId))
      })
    } else {
      // 无法移动（已到达程序末尾）
      this.sendResponse(response)
      this.sendEvent(new debugadapter.TerminatedEvent())
    }

    // StepOut: 处理完当前剩余的兄弟节点后,回到父节点
    // 1. 发送当前节点的所有剩余兄弟节点的源码
    // 2. 如果当前在字典/数组内部，发送结束标记
    // 3. 回到父节点
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
    const startMarker = `GS_EVAL_START(${id})`
    const endMarker = `GS_EVAL_END(${id})`
    // Use print markers and then the expression, then end marker
    // Ensure expression ends with newline
    const wrapper = `(${startMarker}) print flush ${expr} (${endMarker}) print flush\n`
    this.gsProcesses.stdin.write(wrapper)
    return endMarker
  }

  private gs_traverse_route(parentRoute: string[]) {
    return this.sendEval(`[${parentRoute.join(' ')}] gs_traverse_route\n`)
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
  private sendUnit(unit: string) {
    if (!this.gsProcesses || !this.gsProcesses.stdin) throw 'Ghostscript not running'
    const unitCounter = this.unitCounter++
    const startMarker = `GS_DBG_START(${unitCounter})`
    const endMarker = `GS_DBG_END(${unitCounter})`
    const wrapper = `(${startMarker}) print flush ${unit} (${endMarker}) print flush\n`
    this.gsProcesses.stdin.write(wrapper)
    return endMarker
  }
}

// Run the session
debugadapter.DebugSession.run(GhostscriptDebugSession)
