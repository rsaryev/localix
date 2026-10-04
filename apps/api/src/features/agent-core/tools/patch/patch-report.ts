// What apply_patch REPORTS: the per-file change record the UI card renders, and
// the model-facing result text (summary line, post-edit region echo, failure
// list). Separated from the apply engine (patch-apply.ts) because it changes for
// its own reason — every tweak to how the result reads back to the model lands
// here, and none of it touches how a hunk is located or written.

import { diffLines } from 'diff'

export interface PatchFileChange {
  path: string
  kind: 'add' | 'update' | 'delete' | 'move'
  movePath?: string
  diff: string
  additions: number
  deletions: number
}

/** A file the patch could not apply, with an actionable reason for the model. */
export interface PatchFailure {
  path: string
  reason: string
}

export interface PatchToolDetails {
  cwd: string
  status: 'validating' | 'applying' | 'completed'
  files: PatchFileChange[]
  /** Total files the patch targeted (applied + failed). */
  totalFiles: number
  appliedFiles: number
  additions: number
  deletions: number
  currentFile?: string
  /** Files that could not be applied — present only on a partial/failed patch. */
  failures?: PatchFailure[]
  /** Count of failed files (mirrors `failures.length`) — convenience for the UI. */
  failedFiles?: number
}

export function toLineCount(before: string, after: string) {
  let additions = 0
  let deletions = 0
  for (const change of diffLines(before, after)) {
    if (change.added) additions += change.count ?? 0
    if (change.removed) deletions += change.count ?? 0
  }
  return { additions, deletions }
}

export function summarize(details: PatchToolDetails): string {
  const { appliedFiles, totalFiles, additions, deletions } = details
  // Full success reads as before; a partial apply names the shortfall up front.
  if (appliedFiles >= totalFiles) {
    const fileWord = totalFiles === 1 ? 'file' : 'files'
    return `Applied patch to ${totalFiles} ${fileWord} (+${additions} -${deletions})`
  }
  return `Applied ${appliedFiles} of ${totalFiles} files (+${additions} -${deletions})`
}

/** Context lines shown around each edited region, and the per-file line budget. */
const REGION_CONTEXT = 2
const REGION_MAX_LINES = 32

export interface UpdatedRegions {
  /** Line-numbered echo of the changed region(s), or '' when there is nothing worth echoing. */
  text: string
  /** True only when the echo shows EVERY line of the new file. */
  complete: boolean
}

/**
 * Line-numbered echo of the regions an update actually changed, read from the
 * NEW file content. Measured motivation: of the apply_patch calls that failed
 * with "context not found", 35% targeted a file whose last successful edit came
 * AFTER the model's last read — it was patching against a stale copy of its own
 * making, because a successful patch reported only "Applied 1 of 1 files". This
 * hands the post-edit state back, the way Claude Code's editor returns a snippet
 * of the edited file, so the next patch anchors on what is really on disk (and a
 * read-back round-trip — 16% of successful edits — becomes unnecessary).
 *
 * Returns '' when nothing changed, or when the edit is too large to echo cheaply.
 */
export function buildUpdatedRegions(oldContent: string, newContent: string): UpdatedRegions {
  const none: UpdatedRegions = { text: '', complete: false }
  if (oldContent === newContent) return none
  const newLines = newContent.split('\n')
  // Changed line numbers (1-based) in the NEW file.
  const changed: number[] = []
  let lineNo = 0
  for (const part of diffLines(oldContent, newContent)) {
    const count = part.count ?? 0
    if (part.removed) continue
    if (part.added) for (let i = 1; i <= count; i += 1) changed.push(lineNo + i)
    lineNo += count
  }
  if (changed.length === 0 || changed.length > REGION_MAX_LINES) return none

  // Merge changed lines into regions, padded by context and coalesced when they
  // would otherwise overlap or sit back-to-back.
  const regions: Array<[number, number]> = []
  for (const n of changed) {
    const lo = Math.max(1, n - REGION_CONTEXT)
    const hi = Math.min(newLines.length, n + REGION_CONTEXT)
    const last = regions[regions.length - 1]
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi)
    else regions.push([lo, hi])
  }
  const total = regions.reduce((sum, [lo, hi]) => sum + (hi - lo + 1), 0)
  if (total > REGION_MAX_LINES) return none

  // The contents are raw (BOM + original line endings), so render display-clean.
  const show = (l: string) => l.replace(/^\uFEFF/, '').replace(/\r$/, '')
  const text = regions
    .map(([lo, hi]) =>
      newLines
        .slice(lo - 1, hi)
        .map((l, i) => `${lo + i}\t${show(l)}`)
        .join('\n'),
    )
    .join('\n  …\n')
  // A trailing "" from the final newline is not a line the echo has to cover.
  const lastLine = newLines[newLines.length - 1] === '' ? newLines.length - 1 : newLines.length
  const complete = regions.length === 1 && regions[0][0] === 1 && regions[0][1] >= lastLine
  return { text, complete }
}

/**
 * Full model-facing result text for a (possibly partial) apply_patch run: the
 * one-line summary, then — when some files were skipped — an explicit, actionable
 * list so the model re-sends a corrected patch for ONLY the failed files instead of
 * re-applying the ones that already landed. Match-tolerance notes trail the list.
 */
export function buildPatchSummary(
  details: PatchToolDetails,
  matchNotes: string[],
  aborted: boolean,
  regionEchoes: Array<{ path: string; regions: UpdatedRegions }> = [],
): string {
  const lines = [summarize(details)]
  for (const { path, regions } of regionEchoes) {
    // The echo shows the CHANGED REGIONS, not the file. On a 200-line file that is
    // five lines — and telling the model "this IS the file on disk" there taught it
    // the other 195 lines no longer exist, which is the very staleness the echo was
    // added to prevent. Claim wholeness only when the echo really covers the file.
    const header = regions.complete
      ? `${path} now reads (this IS the file on disk — do not re-read it):`
      : `${path} — the lines around your change now read as follows. The rest of the file is untouched, so you do not need to re-read it:`
    lines.push(`\n${header}\n${regions.text}`)
  }
  if (aborted) lines.push('Stopped before all files were processed (the run was cancelled).')
  const failures = details.failures ?? []
  if (failures.length > 0) {
    const plural = failures.length === 1 ? '' : 's'
    lines.push(
      details.appliedFiles > 0
        ? `${failures.length} file${plural} could not be applied. The ${details.appliedFiles} file(s) above WERE applied and are already saved — do NOT send them again. ` +
            `Send a NEW apply_patch containing ONLY the failed file${plural} below, with corrected context:`
        : `No files were applied — fix the issue${plural} below and retry:`,
    )
    for (const failure of failures) lines.push(`- ${failure.path}: ${failure.reason}`)
  }
  if (matchNotes.length > 0) lines.push(...matchNotes)
  return lines.join('\n')
}
