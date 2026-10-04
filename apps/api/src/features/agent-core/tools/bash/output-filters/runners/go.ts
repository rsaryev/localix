import type { OutputFilter } from '../types'

const PKG_RESULT = /^(ok|FAIL|\?)\s+\S+/
const NOISE = /^(=== (RUN|PAUSE|CONT)\s|--- PASS:|\s+--- PASS:|PASS$)/

/**
 * `go test` — `=== RUN` / `--- PASS` / `--- FAIL` per (sub)test, package
 * result lines `ok pkg 0.1s` / `FAIL pkg 0.2s`, failure detail indented
 * under `--- FAIL:`.
 *
 * Pass-all → package result lines only. Failures → drop the RUN/PASS noise,
 * keep `--- FAIL:` blocks with their detail lines + package results.
 */
export const goTestFilter: OutputFilter = {
  name: 'go-test',
  detect: (command, output) =>
    /(?:^|[\s;&|])go\s+test\b/.test(command) ||
    (/^(ok|FAIL)\s+\S+/m.test(output) && /^(=== RUN\s|--- (PASS|FAIL):)/m.test(output)),
  filter(output) {
    const lines = output.split('\n')
    const pkgLines = lines.filter((l) => PKG_RESULT.test(l))
    if (pkgLines.length === 0) return null
    const hasFail = lines.some((l) => /^(\s*--- FAIL:|FAIL\b)/.test(l))

    if (!hasFail) return pkgLines.join('\n')
    return lines.filter((l) => !NOISE.test(l)).join('\n')
  },
}
