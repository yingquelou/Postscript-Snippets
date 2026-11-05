/**
 * Severity policy for structural (mark/container) diagnostics.
 *
 * Precedence, strongest evidence first:
 *   1. `error`        — parse-level failures are never downgraded (L1 rule).
 *   2. gs verdict     — a clean interpreter run for the exact document version
 *                       settles aliasing questions the static layer cannot
 *                       follow; the warning becomes an advisory hint (PS014).
 *   3. build context  — balanced in the merged analysis unit (PS012).
 *   4. single file    — the plain structural warning (PS009).
 *
 * Kept free of vscode imports so the precedence is unit-testable.
 */

export type StructuralLevel = 'error' | 'warning' | 'hint'

export interface StructuralClassification {
  level: StructuralLevel
  code: 'PS001' | 'PS009' | 'PS012' | 'PS014'
  /** appended to the original message, empty when nothing to add */
  suffix: string
}

export interface StructuralDiagnosticInput {
  /** the parser flagged this as a warning (structural) rather than an error */
  isWarning: boolean
  /** a clean gs run exists for exactly the version being validated */
  gsClean?: boolean
  /** operands above the final mark reported by the residue probe */
  residue?: number
  /** the construct balances in the merged build stream */
  balancedInContext?: boolean
}

export function classifyStructuralDiagnostic(input: StructuralDiagnosticInput): StructuralClassification {
  if (!input.isWarning) {
    return { level: 'error', code: 'PS001', suffix: '' }
  }

  if (input.gsClean) {
    const residue = input.residue
    return {
      level: 'hint',
      code: 'PS014',
      suffix: residue !== undefined && residue > 0
        ? ` — gs ran clean but left ${residue} operand(s) above the final mark`
        : ' — gs-verified: the file runs (structural advisory only)'
    }
  }

  if (input.balancedInContext) {
    return { level: 'hint', code: 'PS012', suffix: ' — balanced in the build context (analysis unit)' }
  }

  return { level: 'warning', code: 'PS009', suffix: '' }
}
