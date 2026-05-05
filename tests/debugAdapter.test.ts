import { describe, it } from 'node:test'
import * as assert from 'node:assert'
import { EventEmitter } from 'node:events'

// We test the stepping logic by creating a minimal test harness that
// replicates the exact same logic as the GhostscriptDebugSession class.
// This avoids the need to mock complex VS Code debug adapter dependencies.

interface CstWalkerState {
  index: number
  currentLine: number
}

class MockCstWalker {
  private _lines: string[]
  private _index: number
  private _breakpoints: Set<number>
  public stepInCallCount = 0
  public nextCallCount = 0
  public stepOutCallCount = 0
  // The line number of the last returned statement (1-based)
  private _currentLine: number = 0
  private _lineBoundaries: number[] = []

  constructor(lines: string[], breakpoints: Set<number> = new Set()) {
    this._lines = lines
    this._index = 0
    this._breakpoints = breakpoints
    
    // Build line boundaries for multi-token line support
    let line = 1
    this._lineBoundaries = lines.map(() => {
      const currentLine = line
      line++
      return currentLine
    })
  }

  stepIn(): string {
    this.stepInCallCount++
    if (this._index >= this._lines.length) return ''
    const text = this._lines[this._index]
    this._currentLine = this._index + 1
    this._index++
    return text
  }

  next(): string {
    this.nextCallCount++
    if (this._index >= this._lines.length) return ''
    const text = this._lines[this._index]
    this._currentLine = this._index + 1
    this._index++
    return text
  }

  stepOut(): string {
    this.stepOutCallCount++
    if (this._index >= this._lines.length) return ''
    const text = this._lines.slice(this._index).join(' ')
    this._currentLine = this._index + 1
    this._index = this._lines.length
    return text
  }

  getCurrentLocation(): { startLine?: number; startColumn?: number } {
    if (this._breakpoints.has(this._currentLine)) {
      return { startLine: this._currentLine, startColumn: 1 }
    }
    return { startLine: this._currentLine, startColumn: 1 }
  }

  saveState(): CstWalkerState {
    return {
      index: this._index,
      currentLine: this._currentLine
    }
  }

  rollback(state: CstWalkerState): void {
    this._index = state.index
    this._currentLine = state.currentLine
  }

  step(): string {
    this.stepInCallCount++
    if (this._index >= this._lines.length) return ''
    const text = this._lines[this._index]
    this._currentLine = this._lineBoundaries[this._index]
    this._index++
    return text
  }

  public stepCallCount = 0
  public locationOverride?: { startLine?: number; startColumn?: number }
  private _stepHistory: string[] = []

  getStepHistory(): string[] {
    return [...this._stepHistory]
  }
}

class TestableDebugSession extends EventEmitter {
  public cstWalker: MockCstWalker | undefined
  public _stepping = false
  public sentResponses: any[] = []
  public sentEvents: any[] = []
  public unitCounter = 0
  public breakpointLines: Set<number> = new Set()
  public _skipCurrentLocation = false
  public _breakpointHitLocation: any = null
  public programPath?: string
  public programText: string = ''

  sendResponse(response: any): void {
    this.sentResponses.push(response)
  }

  sendEvent(event: any): void {
    this.sentEvents.push(event)
  }

  isBreakpointHit(location: { startLine?: number }): boolean {
    if (location.startLine == null) return false
    return this.breakpointLines.has(location.startLine)
  }

  sendUnit(unit: string): string {
    const eventName = `PS_DBG_END(${this.unitCounter++})`
    setImmediate(() => {
      this.emit(eventName, '')
    })
    return eventName
  }

  // --- continueRequest (exact same logic as debugAdapter.ts) ---
  doContinueRequest(response: any, args: any): void {
    if (!this.cstWalker) {
      this.sendResponse(response)
      this.sendEvent({ event: 'terminated', body: {} })
      return
    }
    if (this._stepping) {
      this.sendResponse(response)
      return
    }
    this.sendResponse(response)
    this._stepping = true

    const doStep = () => {
      if (!this._stepping) return
      const text = this.cstWalker!.stepIn()
      if (!text) {
        this._stepping = false
        this.sendEvent({ event: 'terminated', body: {} })
        return
      }
      const eventName = this.sendUnit(text)
      this.once(eventName, (_msg: any) => {
        if (!this._stepping) return
        if (_msg?.message) {
          this._stepping = false
          return
        }
        const location = this.cstWalker?.getCurrentLocation()
        if (location && this.isBreakpointHit(location)) {
          this._stepping = false
          this.sendEvent({ event: 'stopped', body: { reason: 'breakpoint', threadId: 1 } })
          return
        }
        setImmediate(doStep)
      })
    }

    setImmediate(doStep)
  }

  // --- nextRequest (exact same logic as debugAdapter.ts) ---
  doNextRequest(response: any, args: any): void {
    if (this._stepping) {
      this.sendResponse(response)
      return
    }
    this._stepping = true
    const result = this.cstWalker?.next()
    if (result) {
      this.once(this.sendUnit(result), () => {
        this._stepping = false
        this.sendResponse(response)
        this.sendEvent({ event: 'stopped', body: { reason: 'step', threadId: args.threadId } })
      })
    } else {
      this._stepping = false
      this.sendResponse(response)
      this.sendEvent({ event: 'terminated', body: {} })
    }
  }

  // --- stepInRequest (exact same logic as debugAdapter.ts) ---
  doStepInRequest(response: any, args: any): void {
    if (this._stepping) {
      this.sendResponse(response)
      return
    }
    this._stepping = true
    const result = this.cstWalker?.stepIn()
    if (result) {
      this.once(this.sendUnit(result), () => {
        this._stepping = false
        this.sendResponse(response)
        this.sendEvent({ event: 'stopped', body: { reason: 'step', threadId: args.threadId } })
      })
    } else {
      this._stepping = false
      this.sendResponse(response)
      this.sendEvent({ event: 'terminated', body: {} })
    }
  }

  // --- stepOutRequest (exact same logic as debugAdapter.ts) ---
  doStepOutRequest(response: any, args: any): void {
    if (this._stepping) {
      this.sendResponse(response)
      return
    }
    this._stepping = true
    const text = this.cstWalker?.stepOut()
    if (text) {
      this.once(this.sendUnit(text), () => {
        this._stepping = false
        this.sendResponse(response)
        this.sendEvent({ event: 'stopped', body: { reason: 'step', threadId: args.threadId } })
      })
    } else {
      this._stepping = false
      this.sendResponse(response)
      this.sendEvent({ event: 'terminated', body: {} })
    }
  }
}

// ==================== Test Helpers ====================

async function waitForSteppingComplete(session: TestableDebugSession, timeout: number = 200): Promise<void> {
  const start = Date.now()
  while (session._stepping && Date.now() - start < timeout) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

function assertEventSent(session: TestableDebugSession, eventName: string): boolean {
  return session.sentEvents.some((e: any) => e.event === eventName)
}

// ==================== Tests ====================

describe('continueRequest', () => {

  it('should send TerminatedEvent when cstWalker is undefined', () => {
    const session = new TestableDebugSession()
    session.cstWalker = undefined
    session.doContinueRequest({ seq: 1 }, {})
    assert.strictEqual(session.sentResponses.length, 1)
    assert.strictEqual(session.sentEvents.length, 1)
    assert.strictEqual(session.sentEvents[0].event, 'terminated')
  })

  it('should step through all statements and send TerminatedEvent when no breakpoints', async () => {
    const session = new TestableDebugSession()
    session.cstWalker = new MockCstWalker(['a', 'b', 'c'])
    session.doContinueRequest({ seq: 1 }, {})

    await new Promise(resolve => setTimeout(resolve, 100))

    assert.strictEqual(session.sentResponses.length, 1)
    const terminatedEvent = session.sentEvents.find((e: any) => e.event === 'terminated')
    assert.ok(terminatedEvent, 'Should send TerminatedEvent when no breakpoints')
    // stepIn is called 4 times: 3 valid statements + 1 empty to detect end
    assert.strictEqual(session.cstWalker.stepInCallCount, 4)
  })

  it('should stop at breakpoint and send StoppedEvent', async () => {
    const session = new TestableDebugSession()
    session.breakpointLines = new Set([2])
    session.cstWalker = new MockCstWalker(['a', 'b', 'c', 'd', 'e'])
    session.doContinueRequest({ seq: 1 }, {})

    await new Promise(resolve => setTimeout(resolve, 100))

    assert.strictEqual(session.sentResponses.length, 1)
    const stoppedEvent = session.sentEvents.find((e: any) => e.event === 'stopped')
    assert.ok(stoppedEvent, 'Should send StoppedEvent when breakpoint hit')
    assert.strictEqual(stoppedEvent.body.reason, 'breakpoint')
    // stepIn is called 2 times: 'a' (line 1, no breakpoint), 'b' (line 2, breakpoint hit)
    assert.strictEqual(session.cstWalker.stepInCallCount, 2)
  })

  it('should ignore concurrent continue requests', async () => {
    const session = new TestableDebugSession()
    session.cstWalker = new MockCstWalker(['a', 'b', 'c', 'd', 'e'])
    session.doContinueRequest({ seq: 1 }, {})
    session.doContinueRequest({ seq: 2 }, {})

    await new Promise(resolve => setTimeout(resolve, 100))

    assert.strictEqual(session.sentResponses.length, 2)
    // stepIn is called 6 times: 5 valid + 1 empty to detect end
    assert.strictEqual(session.cstWalker.stepInCallCount, 6)
  })

  it('should handle Ghostscript error during continue', async () => {
    const session = new TestableDebugSession()
    session.cstWalker = new MockCstWalker(['a', 'b', 'c'])

    const origSendUnit = session.sendUnit.bind(session)
    session.sendUnit = (unit: string): string => {
      const eventName = `PS_DBG_END(${session.unitCounter++})`
      setImmediate(() => {
        session.emit(eventName, { message: 'Test error' })
      })
      return eventName
    }

    session.doContinueRequest({ seq: 1 }, {})

    await new Promise(resolve => setTimeout(resolve, 100))

    assert.strictEqual(session.sentResponses.length, 1)
    assert.strictEqual(session._stepping, false)
  })

  it('should handle empty program (no statements)', async () => {
    const session = new TestableDebugSession()
    session.cstWalker = new MockCstWalker([])
    session.doContinueRequest({ seq: 1 }, {})

    await new Promise(resolve => setTimeout(resolve, 100))

    assert.strictEqual(session.sentResponses.length, 1)
    const terminatedEvent = session.sentEvents.find((e: any) => e.event === 'terminated')
    assert.ok(terminatedEvent, 'Should send TerminatedEvent for empty program')
  })

  it('should reset _stepping flag after continue completes', async () => {
    const session = new TestableDebugSession()
    session.cstWalker = new MockCstWalker(['a', 'b'])
    session.doContinueRequest({ seq: 1 }, {})

    await new Promise(resolve => setTimeout(resolve, 100))

    assert.strictEqual(session._stepping, false)
  })
})

describe('nextRequest', () => {
  it('should step to next statement and send StoppedEvent', async () => {
    const session = new TestableDebugSession()
    session.cstWalker = new MockCstWalker(['a', 'b', 'c'])
    session.doNextRequest({ seq: 1 }, { threadId: 1 })

    await new Promise(resolve => setTimeout(resolve, 100))

    assert.strictEqual(session.sentResponses.length, 1)
    const stoppedEvent = session.sentEvents.find((e: any) => e.event === 'stopped')
    assert.ok(stoppedEvent, 'Should send StoppedEvent after next')
    assert.strictEqual(stoppedEvent.body.reason, 'step')
  })

  it('should ignore concurrent next during continue', async () => {
    const session = new TestableDebugSession()
    session.cstWalker = new MockCstWalker(['a', 'b', 'c'])
    session._stepping = true
    session.doNextRequest({ seq: 1 }, { threadId: 1 })

    assert.strictEqual(session.sentResponses.length, 1)
    assert.strictEqual(session.cstWalker.nextCallCount, 0)
  })

  it('should send TerminatedEvent when no more statements', async () => {
    const session = new TestableDebugSession()
    session.cstWalker = new MockCstWalker(['a'])
    session.doNextRequest({ seq: 1 }, { threadId: 1 })
    await new Promise(resolve => setTimeout(resolve, 100))
    session.doNextRequest({ seq: 2 }, { threadId: 1 })
    await new Promise(resolve => setTimeout(resolve, 100))

    const terminatedEvent = session.sentEvents.find((e: any) => e.event === 'terminated')
    assert.ok(terminatedEvent, 'Should send TerminatedEvent when no more statements')
  })
})

describe('stepInRequest', () => {
  it('should step in and send StoppedEvent', async () => {
    const session = new TestableDebugSession()
    session.cstWalker = new MockCstWalker(['a', 'b', 'c'])
    session.doStepInRequest({ seq: 1 }, { threadId: 1 })

    await new Promise(resolve => setTimeout(resolve, 100))

    assert.strictEqual(session.sentResponses.length, 1)
    const stoppedEvent = session.sentEvents.find((e: any) => e.event === 'stopped')
    assert.ok(stoppedEvent, 'Should send StoppedEvent after stepIn')
    assert.strictEqual(stoppedEvent.body.reason, 'step')
  })
})

describe('stepOutRequest', () => {
  it('should step out and send StoppedEvent', async () => {
    const session = new TestableDebugSession()
    session.cstWalker = new MockCstWalker(['a', 'b', 'c'])
    session.doStepOutRequest({ seq: 1 }, { threadId: 1 })

    await new Promise(resolve => setTimeout(resolve, 100))

    assert.strictEqual(session.sentResponses.length, 1)
    const stoppedEvent = session.sentEvents.find((e: any) => e.event === 'stopped')
    assert.ok(stoppedEvent, 'Should send StoppedEvent after stepOut')
    assert.strictEqual(stoppedEvent.body.reason, 'step')
  })
})

describe('state management', () => {
  it('should prevent stepIn during continue', async () => {
    const session = new TestableDebugSession()
    session.cstWalker = new MockCstWalker(['a', 'b', 'c', 'd', 'e'])
    session.doContinueRequest({ seq: 1 }, {})
    session.doStepInRequest({ seq: 2 }, { threadId: 1 })

    await new Promise(resolve => setTimeout(resolve, 100))

    assert.strictEqual(session.sentResponses.length, 2)
    // stepIn is called 6 times: 5 valid + 1 empty to detect end
    assert.strictEqual(session.cstWalker.stepInCallCount, 6)
    assert.strictEqual(session.cstWalker.nextCallCount, 0)
  })

  it('should allow stepping after continue completes', async () => {
    const session = new TestableDebugSession()
    // Use a breakpoint to stop continue early, leaving remaining statements
    session.breakpointLines = new Set([2])
    session.cstWalker = new MockCstWalker(['a', 'b', 'c', 'd'])
    session.doContinueRequest({ seq: 1 }, {})

    await new Promise(resolve => setTimeout(resolve, 100))

    assert.strictEqual(session._stepping, false)
    // Continue stopped at breakpoint on line 2 (statement 'b')
    // Walker index is now at 2 (0-based), so 'c' is next

    session.doStepInRequest({ seq: 2 }, { threadId: 1 })
    await new Promise(resolve => setTimeout(resolve, 100))

    assert.strictEqual(session.sentResponses.length, 2)
    const stoppedEvent = session.sentEvents.find((e: any) => e.event === 'stopped')
    assert.ok(stoppedEvent)
  })
})

describe('breakpoint handling', () => {
  it('should correctly identify breakpoint hit', () => {
    const session = new TestableDebugSession()
    session.breakpointLines = new Set([3, 5, 7])
    
    assert.strictEqual(session.isBreakpointHit({ startLine: 3 }), true)
    assert.strictEqual(session.isBreakpointHit({ startLine: 4 }), false)
    assert.strictEqual(session.isBreakpointHit({ startLine: 5 }), true)
    assert.strictEqual(session.isBreakpointHit({ startLine: undefined }), false)
  })

  it('should stop exactly at breakpoint line', async () => {
    const session = new TestableDebugSession()
    session.breakpointLines = new Set([3])
    session.cstWalker = new MockCstWalker(['line1', 'line2', 'line3', 'line4', 'line5'])
    
    session.doContinueRequest({ seq: 1 }, {})
    await waitForSteppingComplete(session)

    assert.strictEqual(session._stepping, false)
    assert.ok(assertEventSent(session, 'stopped'))
    
    const stoppedEvent = session.sentEvents.find((e: any) => e.event === 'stopped')
    assert.strictEqual(stoppedEvent.body.reason, 'breakpoint')
    assert.strictEqual(session.cstWalker.stepInCallCount, 3)
  })
})

describe('boundary conditions', () => {
  it('should handle single line program correctly', async () => {
    const session = new TestableDebugSession()
    session.cstWalker = new MockCstWalker(['onlyOneStatement'])
    
    session.doContinueRequest({ seq: 1 }, {})
    await waitForSteppingComplete(session)
    
    assert.ok(assertEventSent(session, 'terminated'))
    assert.strictEqual(session._stepping, false)
  })

  it('should handle stepping past end of program', async () => {
    const session = new TestableDebugSession()
    session.cstWalker = new MockCstWalker(['a', 'b'])
    
    // Execute all statements
    session.doContinueRequest({ seq: 1 }, {})
    await waitForSteppingComplete(session)
    
    // Try to step again
    session.doNextRequest({ seq: 2 }, { threadId: 1 })
    await waitForSteppingComplete(session)
    
    const terminatedEvents = session.sentEvents.filter((e: any) => e.event === 'terminated')
    assert.strictEqual(terminatedEvents.length, 2)
  })
})

describe('execution control', () => {
  it('should reset stepping flag after step operation completes', async () => {
    const session = new TestableDebugSession()
    session.cstWalker = new MockCstWalker(['a', 'b', 'c'])
    
    session.doNextRequest({ seq: 1 }, { threadId: 1 })
    await waitForSteppingComplete(session)
    
    assert.strictEqual(session._stepping, false)
    assert.ok(assertEventSent(session, 'stopped'))
  })

  it('should properly handle stepOut that reaches program end', async () => {
    const session = new TestableDebugSession()
    session.cstWalker = new MockCstWalker(['a'])
    
    session.doStepOutRequest({ seq: 1 }, { threadId: 1 })
    await waitForSteppingComplete(session)
    
    assert.ok(assertEventSent(session, 'stopped'))
    assert.strictEqual(session._stepping, false)
  })

  it('should maintain state consistency across multiple step operations', async () => {
    const session = new TestableDebugSession()
    session.cstWalker = new MockCstWalker(['a', 'b', 'c', 'd', 'e'])
    
    session.doNextRequest({ seq: 1 }, { threadId: 1 })
    await waitForSteppingComplete(session)
    
    session.doNextRequest({ seq: 2 }, { threadId: 1 })
    await waitForSteppingComplete(session)
    
    assert.strictEqual(session.cstWalker.nextCallCount, 2)
    assert.strictEqual(session.sentResponses.length, 2)
  })
})

describe('error handling', () => {
  it('should terminate stepping on execution error', async () => {
    const session = new TestableDebugSession()
    session.cstWalker = new MockCstWalker(['a', 'b', 'c'])

    const originalSendUnit = session.sendUnit.bind(session)
    session.sendUnit = (unit: string): string => {
      const eventName = `PS_DBG_END(${session.unitCounter++})`
      setImmediate(() => {
        session.emit(eventName, { message: 'Execution error' })
      })
      return eventName
    }

    session.doContinueRequest({ seq: 1 }, {})
    await waitForSteppingComplete(session)

    assert.strictEqual(session._stepping, false)
    assert.strictEqual(session.sentResponses.length, 1)
  })
})
