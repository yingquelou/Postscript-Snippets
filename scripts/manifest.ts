import * as fs from 'fs'
import * as path from 'path'

const rootDir = path.join(__dirname, '..')
const packageFile = path.join(rootDir, 'package.json')

export interface RestoreResult {
  changed: boolean
  reason: string
}

/**
 * Remove the build-generated `contributes.snippets` field from package.json.
 *
 * `contributes.snippets` is a manifest of `.snippets/*.json`, which are
 * generated from `Operators.md` headings. The field therefore must be present
 * while `vsce` reads the manifest, but must never be committed: its value is
 * derived from generated files that git does not track, so tracking it would
 * mean a second, hand-maintained copy of the same list.
 *
 * This function is idempotent and safe to call at any time (missing field is a
 * no-op). It preserves the trailing newline and skips the write when the
 * serialized result already matches the file byte for byte, so a restore never
 * produces a spurious diff.
 */
export function restoreManifest(): RestoreResult {
  const raw = fs.readFileSync(packageFile, 'utf8')
  const manifest = JSON.parse(raw) as Record<string, any>

  const contributes = manifest.contributes
  const hasField = !!contributes && typeof contributes === 'object' && 'snippets' in contributes
  if (!hasField) {
    return { changed: false, reason: 'no generated snippets field' }
  }

  delete contributes.snippets

  // same indentation and trailing newline as snippetsGenerator writes
  const serialized = JSON.stringify(manifest, null, '\t') + '\n'
  if (serialized === raw) {
    return { changed: false, reason: 'already identical' }
  }

  fs.writeFileSync(packageFile, serialized)
  return { changed: true, reason: 'removed contributes.snippets' }
}
