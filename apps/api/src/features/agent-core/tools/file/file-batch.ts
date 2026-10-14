/**
 * The per-file outcome of a batched `edit` or `write`, and the one result both tools return.
 *
 * A batch reports like bash's `keep_going`: every file is applied or failed on its own, the
 * result names each, and the CALL is an error only when no file was applied. Flagging a
 * partly-applied batch as an error would tell the model nothing reached disk (it did) and feed
 * the loop's consecutive-error guard for the very batching that saves round-trips.
 */
import type { AgentToolResult } from '@localixai/agent/agents'

import { fileOpenMarkdownLink, fileUiUri } from '../source-refs'
import { buildToolError } from '../tool-errors'
import { appendDiagnostics, appendEditorBufferNote, capDiff, MAX_DIFF_LINES } from './file-utils'

/** One file of a batch. `failed` files were left exactly as they were. */
export interface FileOutcome {
  path: string
  openUri?: string
  failed?: true
  /** Why the file was not changed (model-facing; the card shows it on the failed row). */
  error?: string
  diff?: string
  /** write: the file did not exist before. */
  created?: boolean
  /** write: bytes written. */
  byteLength?: number
  /** edit: occurrences replaced across the file's edits. */
  replacements?: number
}

export interface FileBatchDetails {
  cwd: string
  files: FileOutcome[]
}

/** A file's outcome plus the line the model reads for it. */
export interface FileResult {
  outcome: FileOutcome
  /** Success summary line (ignored for a failed file, whose `error` is its line). */
  line?: string
  retryable?: boolean
  /** `<editor_buffer>` note captured before the write. */
  editorNote?: string
}

export function appliedFile(path: string, line: string, fields: Partial<FileOutcome>): FileResult {
  return { outcome: { path, openUri: fileUiUri({ path }), ...fields }, line }
}

export function failedFile(path: string, error: string, retryable = false): FileResult {
  return { outcome: { path, failed: true, error }, retryable }
}

/**
 * Smallest diff share per file. The batch's diffs are display-only and share the single-call
 * cap ({@link MAX_DIFF_LINES}) so a ten-file batch does not persist ten full-size diffs; the
 * floor keeps each file's diff readable.
 */
const MIN_DIFF_LINES_PER_FILE = 60

/**
 * The tool result for a finished batch: one line per file in call order (an applied file with
 * its Open link, a failed file with its reason), a bottom line when the outcome is mixed, then
 * the language-server block for the applied files and any editor-buffer notes.
 */
export function batchResult(
  cwd: string,
  results: readonly FileResult[],
  diagnostics: string | undefined,
): AgentToolResult<FileBatchDetails> {
  const applied = results.filter((r) => !r.outcome.failed)
  const failed = results.filter((r) => r.outcome.failed)
  const share = Math.max(
    MIN_DIFF_LINES_PER_FILE,
    Math.floor(MAX_DIFF_LINES / Math.max(1, applied.length)),
  )
  const details: FileBatchDetails = {
    cwd,
    files: results.map(({ outcome }) =>
      outcome.diff ? { ...outcome, diff: capDiff(outcome.diff, share) } : outcome,
    ),
  }
  const lines = results.map(({ outcome, line }) =>
    outcome.failed
      ? results.length > 1
        ? `Not changed — ${outcome.error}`
        : (outcome.error ?? '')
      : `${line}\nOpen in Localix: ${fileOpenMarkdownLink(outcome.path)}`,
  )
  if (applied.length > 0 && failed.length > 0) {
    lines.push(
      `[${failed.length} of ${results.length} files failed and were left unchanged; the other ` +
        `${applied.length} were saved — do not send them again. Re-send only the failed ones.]`,
    )
  }
  const notes = results.map((r) => r.editorNote ?? '').filter(Boolean)
  const content = notes.reduce(
    (text, note) => appendEditorBufferNote(text, note),
    appendDiagnostics(lines.join('\n'), diagnostics),
  )
  if (applied.length > 0 || results.length === 0) return { content, details }
  const message = failed.length === 1 ? (failed[0].outcome.error ?? content) : content
  return {
    ...buildToolError({ content, message, retryable: failed.some((r) => r.retryable) }),
    details,
  }
}
