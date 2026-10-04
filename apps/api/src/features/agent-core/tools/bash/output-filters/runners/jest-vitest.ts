import type { OutputFilter } from '../types'

const JEST_TESTS_LINE = /^Tests:\s+.*\d+ total/
const JEST_SUMMARY = /^(Test Suites:|Tests:|Snapshots:|Time:|Ran all test suites)/

/**
 * `jest` — `PASS`/`FAIL <file>` per suite, `✓/✗` per test (verbose), `●`
 * failure detail blocks, tail summary `Test Suites: … / Tests: … / Time: …`.
 *
 * Pass-all → summary lines only. Failures → drop `PASS` suite lines and `✓`
 * per-test lines; `FAIL` suites, `●` blocks and the summary stay.
 */
export const jestFilter: OutputFilter = {
  name: 'jest',
  detect: (command, output) =>
    /(?:^|[\s;&|/])jest\b/.test(command) ||
    (/^(PASS|FAIL)\s+\S+/m.test(output) && /^Tests:\s+/m.test(output)),
  filter(output) {
    const lines = output.split('\n')
    const testsLine = lines.find((l) => JEST_TESTS_LINE.test(l.trim()))
    if (!testsLine) return null
    const hasFailures = /\d+ failed/.test(testsLine)

    if (!hasFailures) return lines.filter((l) => JEST_SUMMARY.test(l.trim())).join('\n')
    if (!lines.some((l) => /^FAIL\s+\S+/.test(l))) return null
    return lines.filter((l) => !/^PASS\s+\S+/.test(l) && !/^\s*[✓✔]\s/.test(l)).join('\n')
  },
}

const VITEST_TESTS_LINE = /^\s*Tests\s+.*\(\d+\)/
const VITEST_SUMMARY = /^\s*(Test Files|Tests|Errors|Start at|Duration)\s/

/**
 * `vitest run` — `✓ file (N tests)` per file, `❯`/`FAIL` failure blocks with
 * `AssertionError` details, tail summary ` Test Files … / Tests … / Duration …`.
 *
 * Pass-all → summary lines only. Failures → drop `✓` lines; failure blocks
 * and the summary stay.
 */
export const vitestFilter: OutputFilter = {
  name: 'vitest',
  detect: (command, output) =>
    /(?:^|[\s;&|/])vitest\b/.test(command) ||
    (/^\s*Test Files\s+\d+/m.test(output) && /^\s*Duration\s/m.test(output)),
  filter(output) {
    const lines = output.split('\n')
    const testsLine = lines.find((l) => VITEST_TESTS_LINE.test(l))
    if (!testsLine) return null
    const hasFailures = /\d+ failed/.test(testsLine)

    if (!hasFailures) return lines.filter((l) => VITEST_SUMMARY.test(l)).join('\n')
    if (!lines.some((l) => /(FAIL|×|✗|❯)/.test(l))) return null
    return lines.filter((l) => !/^\s*[✓✔]\s/.test(l)).join('\n')
  },
}
