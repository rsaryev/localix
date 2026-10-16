import type { OutputFilter } from '../types'

// eslint "stylish" format: per-file blocks (a non-indented path header, then
// indented `  L:C  error|warning  message  rule` rows), then a summary
// `✖ N problems (X errors, Y warnings)` and an optional `… potentially fixable`.
const SUMMARY = /✖ (\d+) problems? \((\d+) errors?, (\d+) warnings?\)/
const FIXABLE = /potentially fixable with the/
const ROW = /^\s+\d+:\d+\s+(?:error|warning)\b/
const ERROR_ROW = /^\s+\d+:\d+\s+error\b/

/**
 * `eslint` (incl. `bun run lint` / `npm run lint`) — noisy per-file blocks of
 * warning + error rows, then the `✖ N problems (X errors, Y warnings)` summary.
 *
 * 0 errors (warnings only) → collapse to the summary (+ fixable) line, dropping
 * every warning row. Errors present → keep only file blocks containing at least
 * one `error` row (drop warning-only blocks) + the summary. Anchored on the `✖`
 * summary; absent, or a shape the parser can't reconcile (e.g. a build wrapper
 * prefixes every line so no clean block/error row is found), → `null` (raw).
 * Never drops a line it hasn't positively identified as warning-only noise.
 */
export const eslintFilter: OutputFilter = {
  name: 'eslint',
  detect: (command, output) =>
    /(?:^|[\s;&|/])eslint\b/.test(command) ||
    /(?:^|[\s;&|])lint\b/.test(command) ||
    SUMMARY.test(output),
  filter(output) {
    const lines = output.split('\n')
    const sumIdx = lines.findIndex((l) => SUMMARY.test(l))
    if (sumIdx === -1) return null
    const errorCount = Number(lines[sumIdx].match(SUMMARY)![2])
    const tail = lines.slice(sumIdx).filter((l) => SUMMARY.test(l) || FIXABLE.test(l))

    // Warnings only → the summary is the whole story; drop every file block.
    if (errorCount === 0) return tail.join('\n')

    // Errors present: keep file blocks that contain ≥1 error row. Walk headers
    // (non-blank, non-row lines) and collect their indented rows.
    const kept: string[] = []
    let sawErrorBlock = false
    let i = 0
    while (i < sumIdx) {
      const line = lines[i]
      if (line.trim() === '' || ROW.test(line)) {
        i++
        continue
      }
      const block = [line]
      let j = i + 1
      let blockHasError = false
      for (; j < sumIdx && ROW.test(lines[j]); j++) {
        if (ERROR_ROW.test(lines[j])) blockHasError = true
        block.push(lines[j])
      }
      if (blockHasError) {
        kept.push(...block, '')
        sawErrorBlock = true
      }
      i = j
    }
    // Summary said errors>0 but the parser found none (unrecognized/prefixed
    // shape) → refuse rather than risk eating a real error.
    if (!sawErrorBlock) return null
    return [...kept, ...tail].join('\n')
  },
}
