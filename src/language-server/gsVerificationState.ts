/**
 * L3 → L0 feedback: remembered Ghostscript verdicts, per document version.
 *
 * A clean gs run is stronger evidence than any static guess about mark
 * balance (gs resolves aliases, `load`, `bind` and conditional `def`s at
 * run time). The record is keyed by document URI + version, so an edit
 * invalidates it automatically — a stale verdict can never suppress a
 * diagnostic for text the interpreter has not seen.
 */

export interface GsVerificationRecord {
  /** document version the verdict belongs to (-1 when unknown) */
  version: number
  /** true when gs exited 0 without an `Error:` block */
  clean: boolean
  /** operands above the nearest mark at end of run; undefined when the probe did not run */
  residue?: number
  verifiedAt: number
}

const MAX_RECORDS = 200
const records = new Map<string, GsVerificationRecord>()

export function recordGsVerification(
  uri: string,
  version: number,
  clean: boolean,
  residue?: number
): void {
  if (!records.has(uri) && records.size >= MAX_RECORDS) {
    let oldestKey: string | undefined
    let oldestAt = Number.POSITIVE_INFINITY
    for (const [key, value] of records) {
      if (value.verifiedAt < oldestAt) {
        oldestAt = value.verifiedAt
        oldestKey = key
      }
    }
    if (oldestKey) records.delete(oldestKey)
  }
  records.set(uri, { version, clean, residue, verifiedAt: Date.now() })
}

export function getGsVerification(uri: string): GsVerificationRecord | undefined {
  return records.get(uri)
}

/** A clean verdict for exactly this version; false for stale or failed runs. */
export function isDocumentGsVerified(uri: string, version: number): boolean {
  const record = records.get(uri)
  return !!record && record.clean && record.version === version
}

export function forgetGsVerification(uri: string): void {
  records.delete(uri)
}

export function clearGsVerificationState(): void {
  records.clear()
}
