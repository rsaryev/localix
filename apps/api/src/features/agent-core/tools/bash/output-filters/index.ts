import type { OutputFilter } from './types'
import { neverWorse } from './never-worse'
import { splitTrailingMarkers, filterMarker } from './markers'
import { bunTestFilter } from './runners/bun'
import { cargoTestFilter } from './runners/cargo'
import { pytestFilter } from './runners/pytest'
import { goTestFilter } from './runners/go'
import { jestFilter, vitestFilter } from './runners/jest-vitest'
import { tscFilter } from './runners/tsc'
import { eslintFilter } from './runners/eslint'
import { installFilter } from './runners/install'
import { buildFilter } from './runners/build'

// Unconditional pre-stage (ANSI strip + secret redaction) — wired in
// bash-output.ts BEFORE this registry, not registered here; see sanitize.ts.
export { sanitizeModelOutput } from './sanitize'

/** First matching filter wins; order = most-specific command detection first. */
const FILTERS: OutputFilter[] = [
  bunTestFilter,
  vitestFilter,
  jestFilter,
  cargoTestFilter,
  pytestFilter,
  goTestFilter,
  tscFilter,
  eslintFilter,
  installFilter,
  buildFilter,
]

/** Below this many lines filtering isn't worth a provenance marker. */
const MIN_LINES = 20

/**
 * Apply the first recognizing content-aware filter to a command's output.
 * Fail-safe by construction: unrecognized shape, uncertain parse (`null`),
 * a thrown parser bug, or a not-smaller result all return the raw output.
 * The UI copy is never filtered — this runs on the model-facing path only.
 */
export function applyOutputFilters(command: string, output: string, toolCallId?: string): string {
  const { body, markers } = splitTrailingMarkers(output)
  const totalLines = body.split('\n').length
  if (totalLines < MIN_LINES) return output

  for (const f of FILTERS) {
    let filtered: string | null
    try {
      if (!f.detect(command, body)) continue
      filtered = f.filter(body)
    } catch {
      return output // fail-safe: a parser bug must never break a bash result
    }
    if (filtered === null) return output
    const keptLines = filtered.split('\n').length
    const composed = [
      filtered,
      filterMarker(f.name, keptLines, totalLines, toolCallId),
      ...markers,
    ].join('\n')
    return neverWorse(output, composed)
  }
  return output
}
