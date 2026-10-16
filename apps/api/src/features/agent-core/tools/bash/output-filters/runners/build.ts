import type { OutputFilter } from '../types'

// A bundler build's OUTCOME is a done line + any error/warning — everything
// between is a per-asset size table (vite/rollup/tsup) or turbo cache-replay
// noise. We KEEP by default and drop ONLY lines positively identified as an
// emitted-asset size row or known build-progress noise, so an error/warning is
// never at risk of being eaten.

// Success/summary anchors across the common bundlers.
const ANCHOR =
  /(?:✓\s*built in [\d.]|(?<!Cannot )\bbuilt in [\d.]|⚡️?\s*Build success|Compiled successfully|✓\s*\d+ modules transformed|(?:^|\s)Tasks:\s+\d+\s+successful|Done in [\d.]+\s*m?s)/
// A build FAILURE has no success anchor — recognise it so we still run (keeping
// everything, dropping only noise → typically a no-op that falls back to raw).
const FAILURE =
  /\b(?:error|ERROR|failed|Build failed|error TS\d+|Cannot find|Could not resolve|(?:^|\s)✖)\b/

// Lines to DROP — narrowly a per-asset size row or known progress noise. A
// leading token (e.g. turbo's `@pkg:build:` prefix, or tsup's `CJS `) is fine;
// the size/gzip signature is what identifies an asset row.
const DROP = [
  /│\s*gzip:/, // vite asset row (always carries the gzip column)
  /(?:^|\s)(?:dist|build|out|\.next|lib|es|cjs|esm|public)\/\S+\s+[\d.]+\s*[kKmMgG]i?[bB]\b/, // path + size (vite/rollup/tsup)
  /^\s*(?:CJS|ESM|IIFE|DTS|CommonJS)\s+\S+\s+[\d.]+\s*[kKmMgG]i?[bB]\b/, // tsup per-format row
  /cache hit, replaying logs/, // turbo replay wrapper
  /(?:transforming|rendering chunks|computing gzip)\s*(?:\(|\.\.\.)/, // vite/rollup progress
]

/**
 * Bundler builds — `vite build`, `tsup`, `turbo build`, `next build`,
 * `rollup`/`esbuild` (incl. `bun run build`). Success prints a done line
 * (`✓ built in Xs` / `Build success` / `Tasks: N successful`) around a bulky
 * per-asset size table; failure prints error lines. Keep everything EXCEPT
 * lines positively identified as an emitted-asset size row or build-progress
 * noise, so errors/warnings always survive. No success anchor AND no failure
 * marker → `null` (pass through raw). A failure with nothing droppable stays
 * raw via the never-worse guard. `tsc --noEmit`/type-check is owned by the tsc
 * runner (it precedes this in the registry).
 */
export const buildFilter: OutputFilter = {
  name: 'build',
  detect: (command, output) =>
    /(?:^|[\s;&|/])(?:vite|tsup|rollup|esbuild)\b/.test(command) ||
    /(?:^|[\s;&|/])(?:turbo(?:\s+run)?|next)\s+build\b/.test(command) ||
    /(?:^|[\s;&|])build\b/.test(command) ||
    ANCHOR.test(output),
  filter(output) {
    const lines = output.split('\n')
    const hasAnchor = lines.some((l) => ANCHOR.test(l))
    // Only engage when there's a recognizable outcome to anchor on: a success
    // line, or errors we can leave intact. Otherwise pass through raw.
    if (!hasAnchor && !lines.some((l) => FAILURE.test(l))) return null
    const kept = lines.filter((l) => !DROP.some((re) => re.test(l)))
    // Must still carry an anchor or an error line, else refuse (don't risk a
    // half-parsed shape). never-worse drops us back to raw if not smaller.
    if (!kept.some((l) => ANCHOR.test(l) || FAILURE.test(l))) return null
    return kept.join('\n')
  },
}
