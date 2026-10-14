import type { OutputFilter } from '../types'

const FINAL_SUMMARY = /^={3,}.*\b(passed|failed|error|errors|no tests ran)\b.*={3,}$/
const SECTION_HEADER = /^={3,} (FAILURES|ERRORS) ={3,}$/

/**
 * `pytest` — progress dots / verbose per-test lines, then on failure a
 * `=== FAILURES ===` section (assertion diffs, captured output), a
 * `short test summary info` block, and a final `=== N failed, M passed in Xs ===`.
 *
 * Pass-all → the final summary line only. Failures → everything from the
 * `FAILURES`/`ERRORS` section header to the end (diffs + short summary + final line).
 */
export const pytestFilter: OutputFilter = {
  name: 'pytest',
  detect: (command, output) =>
    /(?:^|[\s;&|/])(pytest|py\.test)\b/.test(command) ||
    /^={5,} test session starts ={5,}$/m.test(output),
  filter(output) {
    const lines = output.split('\n')
    let summaryIdx = -1
    for (let i = lines.length - 1; i >= 0; i--) {
      if (FINAL_SUMMARY.test(lines[i].trim())) {
        summaryIdx = i
        break
      }
    }
    if (summaryIdx === -1) return null
    const summary = lines[summaryIdx].trim()
    const hasFailures = /\b(failed|error|errors)\b/.test(summary)

    if (!hasFailures) return summary

    const sectionIdx = lines.findIndex((l) => SECTION_HEADER.test(l.trim()))
    if (sectionIdx === -1) return null
    return lines.slice(sectionIdx).join('\n')
  },
}
