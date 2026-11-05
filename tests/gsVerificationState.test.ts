import { describe, it, beforeEach } from 'node:test'
import * as assert from 'node:assert'
import {
  recordGsVerification,
  getGsVerification,
  isDocumentGsVerified,
  forgetGsVerification,
  clearGsVerificationState
} from '../out/language-server/gsVerificationState.js'
import { classifyStructuralDiagnostic } from '../out/language-server/structuralDiagnostics.js'

describe('gsVerificationState (L3 → L0 feedback)', () => {
  beforeEach(() => clearGsVerificationState())

  it('verifies a document only for the exact version gs has seen', () => {
    recordGsVerification('file:///a.ps', 7, true, 0)
    assert.strictEqual(isDocumentGsVerified('file:///a.ps', 7), true)
    assert.strictEqual(isDocumentGsVerified('file:///a.ps', 8), false, 'an edit invalidates the verdict')
  })

  it('a failed run never verifies anything', () => {
    recordGsVerification('file:///a.ps', 3, false)
    assert.strictEqual(isDocumentGsVerified('file:///a.ps', 3), false)
    assert.strictEqual(getGsVerification('file:///a.ps')?.clean, false)
  })

  it('keeps the residue count for message refinement', () => {
    recordGsVerification('file:///a.ps', 1, true, 4)
    assert.strictEqual(getGsVerification('file:///a.ps')?.residue, 4)
  })

  it('forget removes the record', () => {
    recordGsVerification('file:///a.ps', 1, true, 0)
    forgetGsVerification('file:///a.ps')
    assert.strictEqual(getGsVerification('file:///a.ps'), undefined)
  })

  it('evicts the oldest record instead of growing without bound', () => {
    for (let i = 0; i < 205; i++) {
      recordGsVerification(`file:///f${i}.ps`, 1, true, 0)
    }
    assert.strictEqual(getGsVerification('file:///f0.ps'), undefined, 'oldest entry evicted')
    assert.ok(getGsVerification('file:///f204.ps'), 'newest entry kept')
  })
})

describe('classifyStructuralDiagnostic (L3 > L1 > single file)', () => {
  it('never downgrades a parse-level error', () => {
    const result = classifyStructuralDiagnostic({ isWarning: false, gsClean: true, balancedInContext: true })
    assert.strictEqual(result.level, 'error')
    assert.strictEqual(result.code, 'PS001')
    assert.strictEqual(result.suffix, '')
  })

  it('keeps the plain warning when nothing stronger is known', () => {
    const result = classifyStructuralDiagnostic({ isWarning: true })
    assert.strictEqual(result.level, 'warning')
    assert.strictEqual(result.code, 'PS009')
  })

  it('downgrades to a gs-verified hint', () => {
    const result = classifyStructuralDiagnostic({ isWarning: true, gsClean: true, residue: 0 })
    assert.strictEqual(result.level, 'hint')
    assert.strictEqual(result.code, 'PS014')
    assert.match(result.suffix, /gs-verified/)
  })

  it('reports the residue count when gs ran clean but left a mark', () => {
    const result = classifyStructuralDiagnostic({ isWarning: true, gsClean: true, residue: 3 })
    assert.strictEqual(result.level, 'hint')
    assert.match(result.suffix, /left 3 operand\(s\)/)
  })

  it('prefers the gs verdict over the composition guess', () => {
    const result = classifyStructuralDiagnostic({ isWarning: true, gsClean: true, residue: 0, balancedInContext: true })
    assert.strictEqual(result.code, 'PS014')
  })

  it('falls back to balanced-in-context without a gs verdict', () => {
    const result = classifyStructuralDiagnostic({ isWarning: true, balancedInContext: true })
    assert.strictEqual(result.level, 'hint')
    assert.strictEqual(result.code, 'PS012')
    assert.match(result.suffix, /build context/)
  })
})
