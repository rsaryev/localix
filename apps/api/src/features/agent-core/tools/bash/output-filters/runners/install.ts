import type { OutputFilter } from '../types'

// A package-install run's OUTCOME is a handful of lines — the terminal summary
// (bun `N packages installed [Xms]` / `Saved lockfile`; npm `added N packages…
// audited M`; pnpm `Packages: +N` / `Done in Xs`; yarn `success Saved lockfile`
// / `Done in Xs`; `up to date`) plus any warning/error/deprecation. Everything
// else — per-package resolve/download/link progress, the long `+ pkg@ver` added
// lists, funding/audit-nag blurbs, progress bars — is bulk noise.
const SUMMARY =
  /(?:\d+ packages? installed|added \d+ packages?|removed \d+ packages?|changed \d+ packages?|Packages: \+\d+|Done in [\d.]+\s*m?s|Saved lockfile|up to date|audited \d+ packages?)/i
// Kept lines: the summary anchors above + anything actionable (warnings,
// deprecations, errors, peer-dependency notes, vulnerability counts).
const KEEP =
  /(?:\d+ packages? installed|added \d+ packages?|removed \d+ packages?|changed \d+ packages?|Packages: \+\d+|Done in [\d.]+\s*m?s|Saved lockfile|up to date|audited \d+ packages?|\bwarn(?:ing)?\b|\bdeprecated\b|\berror\b|ERR!|vulnerabilit|\bpeer\b)/i

/**
 * `bun install` / `npm install` / `pnpm install` / `yarn` (+ their `add`/`i`/
 * `ci` forms) — noisy resolve/download progress + a long added-package list,
 * then a terminal summary. Keep the summary line(s) + every warning/error/
 * deprecation/peer line; drop the progress, the `+ pkg@ver` list, and the
 * funding/audit-nag chatter. No install summary anchor seen → `null` (pass
 * through raw): an unrecognized shape (or a non-install command that merely
 * matched `detect`) is left untouched. Never drops a warning/error line.
 */
export const installFilter: OutputFilter = {
  name: 'install',
  detect: (command, output) =>
    /(?:^|[\s;&|/])bun\s+(?:install|i|add|ci)\b/.test(command) ||
    /(?:^|[\s;&|/])npm\s+(?:install|i|ci|add)\b/.test(command) ||
    /(?:^|[\s;&|/])pnpm\s+(?:install|i|add)\b/.test(command) ||
    /(?:^|[\s;&|/])yarn(?:\s+(?:install|add))?(?:$|\s)/.test(command) ||
    SUMMARY.test(output),
  filter(output) {
    const lines = output.split('\n')
    if (!lines.some((l) => SUMMARY.test(l))) return null
    const kept = lines.filter((l) => KEEP.test(l))
    // Must have actually retained the summary anchor, else pass through raw.
    if (!kept.some((l) => SUMMARY.test(l))) return null
    return kept.join('\n')
  },
}
