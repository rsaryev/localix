import type { OutputFilter } from '../types'

// A tsc diagnostic line fully identifies the error on its own: plain format
// `path(line,col): error TS####: message`, pretty format
// `path:line:col - error TS####: message`. In pretty mode a blank line + a
// numbered source excerpt + a caret line follow — derivable context we drop.
const ERROR_LINE = /error TS\d+:/
// `Found 3 errors in 2 files.` / `Found 1 error.` / `Found 0 errors.`
const SUMMARY = /^Found \d+ errors?(?: in \d+ files?)?\.?$/

/**
 * `tsc` / `tsc --noEmit` (incl. `bun run type-check`) — a clean run prints
 * little; a failing run prints one `error TS####:` line per diagnostic (plus,
 * in `--pretty`, a source excerpt + caret block) and a trailing `Found N errors`.
 *
 * Keep every `error TS` line (each names path/line/col + code + message = the
 * error's full identity) + the `Found N errors` summary; drop the pretty
 * excerpt/caret noise and any passing chatter. No `error TS` line seen → `null`
 * (pass through raw): a clean or unrecognized run is left untouched.
 */
export const tscFilter: OutputFilter = {
  name: 'tsc',
  detect: (command, output) =>
    /(?:^|[\s;&|/])tsc\b/.test(command) ||
    /(?:^|[\s;&|])(?:type-check|typecheck)\b/.test(command) ||
    ERROR_LINE.test(output),
  filter(output) {
    const lines = output.split('\n')
    if (!lines.some((l) => ERROR_LINE.test(l))) return null
    const kept = lines.filter((l) => ERROR_LINE.test(l) || SUMMARY.test(l.trim()))
    // Must have actually captured the diagnostics, else pass through raw.
    if (!kept.some((l) => ERROR_LINE.test(l))) return null
    return kept.join('\n')
  },
}
