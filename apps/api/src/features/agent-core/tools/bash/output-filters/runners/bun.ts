import type { OutputFilter } from '../types'

const SUMMARY_PASS = /^\s*\d+ pass$/
const SUMMARY_FAIL = /^\s*(\d+) fail$/
const RAN_LINE = /^Ran \d+ tests? across /

/**
 * `bun test` — report goes to stderr: header `bun test v…`, per-file sections
 * with console noise + code-excerpt blocks per failure, `(pass)`/`(fail)`
 * per-test lines, tail summary (` N pass`, ` N fail`, ` N expect() calls`,
 * `Ran N tests across M files.`).
 *
 * Pass-all → header + tail summary (drops console noise from test bodies).
 * Failures → drop only `(pass)` lines; every failure excerpt stays intact.
 */
export const bunTestFilter: OutputFilter = {
  name: 'bun-test',
  detect: (command, output) =>
    /(?:^|[\s;&|])bun\s+(?:run\s+)?test\b/.test(command) || /^bun test v\d/m.test(output),
  filter(output) {
    const lines = output.split('\n')
    const failLineIdx = lines.findIndex((l) => SUMMARY_FAIL.test(l))
    const passLineIdx = lines.findIndex((l) => SUMMARY_PASS.test(l))
    if (failLineIdx === -1 || passLineIdx === -1 || !lines.some((l) => RAN_LINE.test(l)))
      return null
    const failCount = Number(lines[failLineIdx].match(SUMMARY_FAIL)![1])

    if (failCount === 0) {
      const header = lines.find((l) => l.startsWith('bun test v'))
      const tail = lines.slice(Math.min(passLineIdx, failLineIdx))
      return [...(header ? [header] : []), ...tail].join('\n')
    }
    // Failures present: parser must actually see them, else pass through raw.
    if (!lines.some((l) => l.startsWith('(fail)'))) return null
    return lines.filter((l) => !l.startsWith('(pass)')).join('\n')
  },
}
