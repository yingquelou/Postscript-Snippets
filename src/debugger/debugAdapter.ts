import * as debugadapter from '@vscode/debugadapter'
import { DebugProtocol } from '@vscode/debugprotocol'
import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { normalizePath, parseLaunchArguments } from './debugHelper'
import { psParserHelper, validatePostScriptExpression } from '../parser/postscriptParser'
import { CstWalker, CstWalkerState } from '../parser/syntaxTreeWalker'
import { streamingBlockParser, Block, FreeBlock } from './StreamingBlockParser'
import { ParsedConfiguration } from './debugConfigurationParser'

const ps_stopped_start_mark = 'PS_EVAL_START'
const ps_stopped_end_mark = 'PS_EVAL_END'
const ps_stepping_start_mark = 'PS_DBG_START'
const ps_stepping_end_mark = 'PS_DBG_END'

class GhostscriptDebugSession extends debugadapter.DebugSession {
  private gsProcesses?: ChildProcessWithoutNullStreams
  private programPath?: string
  private programText: string = ''
  private breakpoints: DebugProtocol.Breakpoint[] = []
  private cstWalker?: CstWalker
  private evalCounter = 1
  private _stepping = false
  private _breakpointHitLocation: any = null
  private _skipCurrentLocation = false
  private _breakpointsReceived = false
  private _pendingAutoStart = false

  public constructor() {
    super()
    this.setDebuggerLinesStartAt1(true)
    this.setDebuggerColumnsStartAt1(true)
  }

  protected initializeRequest(response: DebugProtocol.InitializeResponse, _args: DebugProtocol.InitializeRequestArguments): void {
    response.body = response.body || {}
    response.body.supportsEvaluateForHovers = true
    response.body.supportTerminateDebuggee = true
    response.body.supportsTerminateRequest = true
    this.sendResponse(response)
    this.sendEvent(new debugadapter.InitializedEvent())
  }
  protected setExceptionBreakPointsRequest(response: DebugProtocol.SetExceptionBreakpointsResponse, _args: DebugProtocol.SetExceptionBreakpointsArguments, _request?: DebugProtocol.Request): void {
    response.body = response.body || {
      breakpoints: [
        { verified: true }
      ]
    }
    this.sendResponse(response)

    this._breakpointsReceived = true
    if (this._pendingAutoStart) {
      this._pendingAutoStart = false
      this.startAutoExecution()
    }
  }
  protected customRequest(_command: string, response: DebugProtocol.Response, _args: any, _request?: DebugProtocol.Request): void {
    this.sendResponse(response)
  }
  protected launchRequest(response: DebugProtocol.LaunchResponse, args: any): void {
    const config = parseLaunchArguments(args)

    if (!this.handleLaunchConfigValidation(response, config)) {
      return
    }

    const { program, ghostscriptPath, cwd, args: gsArgs } = config.config!

    if (!this.initializeProgramConfiguration(program, gsArgs)) {
      this.sendResponse(response)
      return
    }

    if (!this.startGhostscriptProcess(ghostscriptPath, gsArgs, cwd)) {
      this.sendResponse(response)
      return
    }

    this.parseProgramSource()
    this.setupProcessEventHandlers(args)
    this.sendLaunchResponse(response)
    this.handleStopOnEntry(args)
  }

  private handleLaunchConfigValidation(response: DebugProtocol.LaunchResponse, config: { success: boolean; config?: ParsedConfiguration; errors?: Array<{ field: string; message: string; suggestion: string }> }): boolean {
    if (!config.success) {
      config.errors?.forEach(error => {
        this.sendEvent(new debugadapter.OutputEvent(`${error.message}\nSuggestion: ${error.suggestion}\n`, 'stderr'))
      })
      this.sendResponse(response)
      this.sendEvent(new debugadapter.TerminatedEvent())
      return false
    }
    return true
  }

  private initializeProgramConfiguration(program: string, gsArgs: string[]): boolean {
    this.programPath = program

    // normalize program path for consistent breakpoint matching
    gsArgs.push('-dNOPROMPT', '-dNOPAUSE', '-sstdout=-', '-sstderr=-')

    return true
  }

  private startGhostscriptProcess(ghostscriptPath: string, gsArgs: string[], cwd: string): boolean {
    const msg = `Using ${ghostscriptPath} with the parameters [${gsArgs}] to debug ${this.programPath} in ${cwd}`
    const helperCandidates = ['dap.ps'].map(v => path.join(__dirname, '..', '..', 'ps', v))
    gsArgs.push(...helperCandidates)
    try {
      this.gsProcesses = spawn(ghostscriptPath, gsArgs, { cwd, shell: false, stdio: 'pipe' })
      this.gsProcesses.stdin.write('dap_init\n')
      this.sendEvent(new debugadapter.OutputEvent(msg, 'console'))
      return true
    } catch (err: any) {
      this.sendEvent(new debugadapter.OutputEvent(`Failed to debug: ${msg}\n`, 'stderr'))
      this.sendEvent(new debugadapter.TerminatedEvent())
      return false
    }
  }

  private parseProgramSource(): void {
    try {
      this.programText = fs.readFileSync(this.programPath!, 'utf8')
      const { cst } = psParserHelper(this.programText)
      if (cst) {
        this.cstWalker = new CstWalker(cst, this.programText)
      } else {
        this.sendEvent(new debugadapter.OutputEvent(`Warning: Failed to parse program. The debugger requires plain PostScript source code and cannot process files containing binary data (e.g., embedded images).\n`, 'stderr'))
      }
    } catch (err: any) {
      this.sendEvent(new debugadapter.OutputEvent(`Failed to read/parse program: ${err.message}\n`, 'stderr'))
    }
  }

  private setupProcessEventHandlers(args: any): void {
    this.setupStdoutHandler()
    this.setupStderrHandler()
    this.setupProcessErrorHandler()
    this.setupProcessCloseHandler()
  }

  private setupStdoutHandler(): void {
    this.gsProcesses!.stdout.on('data', chunk => {
      streamingBlockParser.write(chunk)

      let block: Block | null
      while ((block = streamingBlockParser.getNextBlock())) {
        this.handleStreamingBlock(block)
      }

      let freeData: FreeBlock | null
      while ((freeData = streamingBlockParser.fetchFreeData())) {
        const content = freeData.data.toString()
        if (content.trim()) {
          this.sendEvent(new debugadapter.OutputEvent(content, 'stdout'))
        }
        freeData.release()
      }
    })
  }

  private handleStreamingBlock(block: Block): void {
    switch (block.type) {
      case 'range':
        this.handleRangeBlock(block)
        break;
      case 'free':
        this.handleFreeBlock(block)
        break;
      default:
        break;
    }
  }

  private handleRangeBlock(block: Block): void {
    if (block.type !== 'range') return;

    switch (block.name) {
      case 'pause':
        this.emit(`${ps_stopped_end_mark}(${block.id})`, block.content.toString(), () => { block?.release() })
        break;
      case 'stepping':
        this.emit(`${ps_stepping_end_mark}(${block.id})`, block.content.toString(), () => { block?.release() })
        break;
      case 'error':
        this.handleErrorBlock(block)
        break;
      default:
        break;
    }
  }

  private handleErrorBlock(block: Block): void {
    if (block.type !== 'range') return;

    try {
      const msg = JSON.parse(block.content)
      const savedState = this.cstWalker?.saveState()
      if (savedState && this.cstWalker && savedState.index > 0) {
        const rollbackState = { ...savedState, index: savedState.index - 1 }
        this.cstWalker.rollback(rollbackState)
        this._stepping = false
        this.sendEvent(new debugadapter.StoppedEvent('exception', 1, msg.error))
      } else {
        this._stepping = false
        this.sendEvent(new debugadapter.StoppedEvent('exception', 1, msg.error))
      }
    } catch (e: any) {
      this.sendEvent(new debugadapter.OutputEvent(`Error parsing error block: ${block.content}\n`, 'stderr'))
    }
    block.release()
    return
  }

  private handleFreeBlock(block: Block): void {
    if (block.type !== 'free') return;

    const content = block.data.toString()
    if (content.trim()) {
      this.sendEvent(new debugadapter.OutputEvent(content, 'console'))
    }
    block.release()
  }

  private setupStderrHandler(): void {
    this.gsProcesses!.stderr.on('data', chunk => {
      try {
        const obj = JSON.parse(chunk)
        this.sendEvent(new debugadapter.StoppedEvent('exception', 1, obj.error))
      } catch (error) {
        this.sendEvent(new debugadapter.OutputEvent(`Ghostscript error: ${error}\n`, 'stderr'))
      }
    })
  }

  private setupProcessErrorHandler(): void {
    this.gsProcesses!.on('error', err => {
      this._stepping = false
      this.sendEvent(new debugadapter.OutputEvent(`Ghostscript error: ${err.message}\n`, 'stderr'))
      this.sendEvent(new debugadapter.TerminatedEvent())
    })
  }

  private setupProcessCloseHandler(): void {
    this.gsProcesses!.on('close', (code, signal) => {
      this._stepping = false
      this.sendEvent(new debugadapter.OutputEvent(`Ghostscript exited with code ${code} signal ${signal}\n`, 'console'))
      this.sendEvent(new debugadapter.ThreadEvent('exited', 1))
      this.sendEvent(new debugadapter.ExitedEvent(code ?? 0))
      this.sendEvent(new debugadapter.TerminatedEvent())
    })
  }

  private sendLaunchResponse(response: DebugProtocol.LaunchResponse): void {
    this.sendResponse(response)
    this.sendEvent(new debugadapter.ThreadEvent('started', 1))
  }

  private validateSteppingState(threadId: number, response: DebugProtocol.Response): boolean {
    if (this._stepping) {
      response.body = { threadId }
      this.sendResponse(response)
      return false
    }

    if (!this.cstWalker) {
      response.body = { threadId }
      this.sendResponse(response)
      this.sendEvent(new debugadapter.TerminatedEvent())
      return false
    }

    return true
  }

  private sendSteppingResponseAndEvent(response: DebugProtocol.Response, threadId: number): void {
    response.body = { threadId }
    this.sendResponse(response)
    this.sendEvent(new debugadapter.ContinuedEvent(threadId))
    this._stepping = true
  }

  private executeSingleUnit(unit: string, onComplete: (msg: string) => void): void {
    const eventName = this.sendPsDuringStepping(unit)
    this.once(eventName, (msg, cb) => {
      if (msg.trim()) {
        this.sendEvent(new debugadapter.OutputEvent(msg + '\n', 'stdout'))
      }
      onComplete(msg)
      cb()
    })
  }

  private checkBreakpointAtCurrentLocation(): DebugProtocol.Breakpoint[] {
    if (!this.cstWalker) return []
    const location = this.cstWalker.getCurrentLocation()
    return this.isBreakpointHit(location)
  }

  private handleStopOnEntry(args: any): void {
    if (args.stopOnEntry) {
      this.sendEvent(new debugadapter.StoppedEvent('entry', 1))
    } else {
      this._skipCurrentLocation = true
      this._stepping = true

      // VS Code 调试协议：launch 请求之后客户端才会发送 setBreakPointsRequest
      // 所以要等待断点设置完成后再开始执行，否则第一行断点不会命中
      if (this._breakpointsReceived) {
        this.startAutoExecution()
      } else {
        this._pendingAutoStart = true
      }
    }
  }

  private executeStep(threadId: number = 1, onComplete?: () => void): void {
    if (!this._stepping || !this.cstWalker) return

    const hitBreakpoints = this.checkBreakpointAtCurrentLocation()

    if (hitBreakpoints.length > 0) {
      this._skipCurrentLocation = true
      this._stepping = false
      this.sendEvent(new debugadapter.StoppedEvent('breakpoint', threadId))
      onComplete?.()
      return
    }

    // 只有在没有命中断点的情况下才处理跳过标记
    if (this._skipCurrentLocation) {
      this._skipCurrentLocation = false
    }

    const savedState = this.cstWalker.saveState()
    const text = this.cstWalker.step()
    if (!text) {
      this._stepping = false
      this.sendEvent(new debugadapter.TerminatedEvent())
      onComplete?.()
      return
    }

    this.executeAndContinue(text, savedState, (continued) => {
      if (!this._stepping) {
        onComplete?.()
        return
      }
      if (continued) {
        setImmediate(() => this.executeStep(threadId, onComplete))
      }
    })
  }

  private startAutoExecution(): void {
    setImmediate(() => this.executeStep())
  }

  protected terminateRequest(response: DebugProtocol.TerminateResponse, args: any): void {
    this._stepping = false
    if (this.gsProcesses && !this.gsProcesses.killed) {
      try { this.gsProcesses.kill() } catch { }
    }
    this.sendResponse(response)
    // 发送 ExitedEvent（exitCode 为 0 表示正常终止）
    this.sendEvent(new debugadapter.ExitedEvent(0))
    this.sendEvent(new debugadapter.TerminatedEvent(args?.restart))
  }

  protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: any): void {
    this._stepping = false
    // 处理 terminateDebuggee 参数
    if (args?.terminateDebuggee !== false && this.gsProcesses && !this.gsProcesses.killed) {
      try { this.gsProcesses.kill() } catch { }
    }
    this.sendResponse(response)
    // 如果终止了调试目标，发送相应事件
    if (args?.terminateDebuggee !== false) {
      this.sendEvent(new debugadapter.ExitedEvent(0))
      this.sendEvent(new debugadapter.TerminatedEvent(args?.restart))
    }
  }

  protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
    response.body = { threads: [new debugadapter.Thread(1, 'Main Thread')] }
    this.sendResponse(response)
  }

  protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
    const allFrames: DebugProtocol.StackFrame[] = []
    if (this.programPath && this.cstWalker) {
      const location = this._breakpointHitLocation || this.cstWalker.getCurrentLocation()
      if (location.startLine && location.startColumn) {
        allFrames.push({
          id: 1,
          name: 'Ghostscript',
          source: { path: this.programPath },
          line: location.startLine,
          column: location.startColumn
        })
      }
      // 处理分页参数
      const startFrame = args.startFrame ?? 0
      const levels = args.levels ?? 0
      const endFrame = levels === 0 ? allFrames.length : startFrame + levels
      const frames = allFrames.slice(startFrame, endFrame)
      // 始终设置响应
      response.body = { stackFrames: frames, totalFrames: allFrames.length }
      this._breakpointHitLocation = null
      this.once(
        this.sendPsDuringPause(`<</threadId ${args.threadId}>> dap_stackTrace`),
        (_text, cb) => {
          cb()
        }
      )
      this.sendResponse(response)
    } else {
      response.body = { stackFrames: [], totalFrames: 0 }
      this.sendResponse(response)
    }
  }

  protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
    this.once(
      this.sendPsDuringPause(`${args.frameId} dap_scopes`), (text, cb) => {
        response.body = { scopes: JSON.parse(text) }
        this.sendResponse(response)
        cb()
      })
  }
  protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments, _request?: DebugProtocol.Request): void {
    const dict = [
      '<<',
      `/variablesReference ${args.variablesReference}`,
      args.filter ? `/filter (${args.filter})` : '',
      `/start ${args.start || 0}`,
      `/count ${args.count || 0}`,
      args.format && args.format.hex ? '/format<</hex true>>' : '',
      '>>'
    ]
    this.once(this.sendPsDuringPause(`${dict.join(' ')} dap_variables`), (text, cb) => {
      response.body = { variables: JSON.parse(text) }
      this.sendResponse(response)
      cb()
    })
  }

  protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
    const threadId = args.threadId || 1
    if (!this.cstWalker) {
      response.body = { allThreadsContinued: false }
      this.sendResponse(response)
      this.sendEvent(new debugadapter.TerminatedEvent())
      return
    }
    if (this._stepping) {
      response.body = { allThreadsContinued: false }
      this.sendResponse(response)
      return
    }
    response.body = { allThreadsContinued: true }
    this.sendResponse(response)
    this.sendEvent(new debugadapter.ContinuedEvent(threadId))
    this._stepping = true

    const doStep = () => {
      if (!this._stepping) return

      const hitBreakpoints = this.checkBreakpointAtCurrentLocation()

      if (hitBreakpoints.length > 0) {
        this._skipCurrentLocation = true
        this._stepping = false
        this.sendEvent(new debugadapter.StoppedEvent('breakpoint', threadId))
        return
      }

      // 只有在没有命中断点的情况下才处理跳过标记
      if (this._skipCurrentLocation) {
        this._skipCurrentLocation = false
      }

      const savedState = this.cstWalker!.saveState()
      const text = this.cstWalker!.step()
      if (!text) {
        this._stepping = false
        this.sendEvent(new debugadapter.TerminatedEvent())
        return
      }

      this.executeAndContinue(text, savedState, (continued) => {
        if (!this._stepping) { return }
        if (continued) {
          setImmediate(doStep)
        }
      })
    }

    if (this._skipCurrentLocation) {
      const currentLocation = this.cstWalker!.getCurrentLocation()
      const currentLine = currentLocation.startLine

      const tokensToSkip: string[] = []
      let sameLine = true

      while (sameLine) {
        const text = this.cstWalker!.step()
        if (!text) {
          sameLine = false
        } else {
          tokensToSkip.push(text)
          const nextLocation = this.cstWalker!.getCurrentLocation()
          sameLine = nextLocation.startLine === currentLine
        }
      }

      if (tokensToSkip.length > 0) {
        const executeTokens = (index: number) => {
          if (index >= tokensToSkip.length || !this._stepping) {
            this._skipCurrentLocation = false
            setImmediate(doStep)
            return
          }

          const text = tokensToSkip[index]
          const savedState = this.cstWalker!.saveState()
          this.executeAndContinue(text, savedState, (continued) => {
            if (continued) {
              executeTokens(index + 1)
            }
          })
        }

        executeTokens(0)
      } else {
        this._stepping = false
        this.sendEvent(new debugadapter.TerminatedEvent())
      }
    } else {
      // Normal continue operation
      setImmediate(doStep)
    }
  }

  protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
    const threadId = args.threadId || 1
    if (!this.validateSteppingState(threadId, response)) return

    this.sendSteppingResponseAndEvent(response, threadId)
    setImmediate(() => this.performStep(threadId, true))
  }

  protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
    const threadId = args.threadId || 1
    if (!this.validateSteppingState(threadId, response)) return

    this.sendSteppingResponseAndEvent(response, threadId)
    setImmediate(() => this.performStep(threadId, true))
  }

  protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
    const threadId = args.threadId || 1
    if (!this.validateSteppingState(threadId, response)) return

    this.sendSteppingResponseAndEvent(response, threadId)
    setImmediate(() => this.performStep(threadId, false))
  }

  protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
    try {
      // 支持多种 context 类型
      switch (args.context) {
        case 'watch':
        case 'repl':
        case 'hover':
        case 'clipboard':
          if (args.expression.trim() === '')
            throw new Error(`Contains only whitespace or line-ending characters`)
          const validation = validatePostScriptExpression(args.expression)
          if (!validation.isValid) throw new Error(validation.error)
          this.once(
            this.sendPsDuringPause(`{${args.expression}} dap_evaluate`), (text, cb) => {
              response.body = JSON.parse(text)
              response.body.result ||= ''
              this.sendResponse(response)
              cb()
            })
          break
        default:
          throw new Error(`Not supported`)
      }
    } catch (error) {
      // 错误处理
      response.success = false
      response.message = error instanceof Error ? error.message : 'Evaluation failed'
      this.sendResponse(response)
    }
  }
  /**
   * Send PostScript source code while the debugger is paused
   *  @returns {string} eval_eventName
  **/
  private sendPsDuringPause(expr: string): string {
    if (!this.gsProcesses || !this.gsProcesses.stdin) throw 'Ghostscript not running'
    const id = this.evalCounter++
    const eventName = `${ps_stopped_end_mark}(${id})`
    // Use print markers and then the expression, then end marker
    // Ensure expression ends with newline
    this.gsProcesses.stdin.write(`(${ps_stopped_start_mark}(${id})) = ${expr} (${eventName}) = flush\n`)
    return eventName
  }

  /** True if the given location (1-based line) hits any breakpoint for the current program. */
  private isBreakpointHit(location: { startLine?: number }): DebugProtocol.Breakpoint[] {
    if (location.startLine == null) {
      return []
    }
    const programNorm = normalizePath(this.programPath)
    const hitBreakpoints = this.breakpoints.filter(b => {
      const bpNorm = normalizePath(b.source?.path)
      return bpNorm === programNorm && b.line === location.startLine && b.verified
    })
    return hitBreakpoints
  }

  protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
    const sourcePath = args.source?.path
    const programNorm = normalizePath(this.programPath)
    const sourceNorm = normalizePath(sourcePath)

    // 处理 sourceModified 参数
    if (args.sourceModified && this.programPath) {
      try {
        this.programText = fs.readFileSync(this.programPath, 'utf8')
        const { cst } = psParserHelper(this.programText)
        if (cst) {
          this.cstWalker = new CstWalker(cst, this.programText)
        }
      } catch (err: any) {
        this.sendEvent(new debugadapter.OutputEvent(`Failed to re-parse modified program: ${err.message}\n`, 'stderr'))
      }
    }

    // Verify source path matches the debugged program
    const isValidSource = !!(programNorm && sourceNorm && programNorm === sourceNorm)

    if (sourcePath) {
      let breakpointId = 1
      const newBreakpoints = (args.breakpoints ?? []).map(v => {
        // Verify breakpoint line is valid (positive integer)
        const isValidLine = !!(v.line && v.line > 0)
        // 验证行号在文件范围内
        const isLineInRange = this.programText ? (v.line && v.line <= this.programText.split('\n').length) : true
        // If we have CST info, we could verify the line has executable code
        const verified = isValidSource && isValidLine && isLineInRange
        return {
          id: breakpointId++,
          verified,
          source: args.source,
          line: v.line,
          column: v.column,
          message: verified ? undefined : (isValidSource ? 'Invalid line number' : 'Source does not match program')
        } as DebugProtocol.Breakpoint
      })

      this.breakpoints = this.breakpoints.filter(b => b.source?.path !== sourcePath)
      this.breakpoints = [...this.breakpoints, ...newBreakpoints]
      response.body = { breakpoints: newBreakpoints }
    } else {
      let breakpointId = 1
      const newBreakpoints = (args.breakpoints ?? []).map(v => ({
        id: breakpointId++,
        verified: !!(v.line && v.line > 0),
        source: args.source,
        line: v.line,
        column: v.column,
      } as DebugProtocol.Breakpoint))
      this.breakpoints = newBreakpoints
      response.body = { breakpoints: newBreakpoints }
    }

    this.sendResponse(response)
  }
  private unitCounter: number = 0
  /**
   * @returns {string} dbg_eventName
   */
  private sendPsDuringStepping(unit: string): string {
    if (!this.gsProcesses) throw 'Ghostscript not running'
    const unitCounter = this.unitCounter++
    const eventName = `${ps_stepping_end_mark}(${unitCounter})`
    this.gsProcesses.stdin.write(`(${ps_stepping_start_mark}(${unitCounter})) = {${unit}} dap_if_error (${eventName}) = flush\n`)
    return eventName
  }

  private executeAndContinue(
    unit: string,
    _savedState: CstWalkerState | undefined,
    onComplete: (continued: boolean) => void
  ): void {
    this.executeSingleUnit(unit, () => {
      onComplete(true)
    })
  }

  private performStep(threadId: number, isLastTokenCheck: boolean): void {
    const result = this.cstWalker?.step()
    if (result) {
      if (isLastTokenCheck) {
        const nextResult = this.cstWalker?.step()
        if (nextResult) {
          this.cstWalker?.rollback({ index: (this.cstWalker.saveState().index - 1) })
          this.executeSingleUnit(result, () => {
            this._stepping = false
            this.sendEvent(new debugadapter.StoppedEvent('step', threadId))
          })
        } else {
          this.executeSingleUnit(result, () => {
            this._stepping = false
            this.sendEvent(new debugadapter.TerminatedEvent())
          })
        }
      } else {
        this.executeSingleUnit(result, () => {
          this._stepping = false
          this.sendEvent(new debugadapter.StoppedEvent('step', threadId))
        })
      }
    } else {
      this._stepping = false
      this.sendEvent(new debugadapter.TerminatedEvent())
    }
  }
}

// Run the session
debugadapter.DebugSession.run(GhostscriptDebugSession)