import type { OutputFilter } from '../types'

const RESULT_LINE = /^test result: (ok|FAILED)\. (\d+) passed; (\d+) failed;/

/**
 * `cargo test` — per-test `test name ... ok` lines, then (on failure) a
 * `failures:` section with `---- name stdout ----` panic blocks and a
 * `failures:` name list, then `test result: ok|FAILED. N passed; N failed; …`
 * per test binary (a workspace run has several).
 *
 * Pass-all → the `test result:` summary lines only (measured 181KB → <1KB on
 * a 2389-test run). Failures → every `failures:` section verbatim
 * (panic text + file:line + failed-test list) + all summary lines.
 */
export const cargoTestFilter: OutputFilter = {
  name: 'cargo-test',
  detect: (command, output) =>
    /(?:^|[\s;&|])cargo\b[^\n]*\btest\b/.test(command) ||
    /^test result: (ok|FAILED)\./m.test(output),
  filter(output) {
    const lines = output.split('\n')
    const summaries = lines.filter((l) => RESULT_LINE.test(l))
    if (summaries.length === 0) return null
    const totalFailed = summaries.reduce((n, l) => n + Number(l.match(RESULT_LINE)![3]), 0)

    if (totalFailed === 0) return summaries.join('\n')

    // Keep each `failures:` … `test result:` region verbatim.
    const kept: string[] = []
    let inFailures = false
    let sawFailures = false
    for (const line of lines) {
      if (/^failures:$/.test(line.trim())) {
        inFailures = true
        sawFailures = true
      }
      if (inFailures) {
        kept.push(line)
        if (RESULT_LINE.test(line)) inFailures = false
      } else if (RESULT_LINE.test(line)) {
        kept.push(line)
      }
    }
    if (!sawFailures) return null
    return kept.join('\n')
  },
}
