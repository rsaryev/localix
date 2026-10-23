import type { FileChange } from '@localixai/agent/agents'
import type { AgentItemStatus } from '@localixai/agent/agents'
import { findLast } from '@localixai/mini-app-sdk/ui/utilities'
import { countEditChanges, countLines, countPatchChanges } from './liveCode'
import { statusLabel } from '../itemHelpers'

// Pure helpers for the file-change card, extracted so the diff-stat aggregation
// and live new-string extraction are testable without the component.

/** Total +/- line counts across every change that carries a diff. */
export function sumDiffStats(changes: FileChange[]): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const change of changes) {
    if (!change.diff) continue
    const counts = countPatchChanges(change.diff)
    additions += counts.additions
    deletions += counts.deletions
  }
  return { additions, deletions }
}

export interface FileChangeSubtitleArgs {
  streaming: boolean
  isWrite: boolean
  hasError: boolean
  /** Paced reveal text (falls back to the raw partial content/patch). */
  smoothedCode: string
  /** Raw partial `content` (write) currently being typed. */
  rawContent?: string
  /** Partial `edits` array (edit-shape tools). */
  edits: unknown
  appliedChanges: FileChange[]
  failedChanges: FileChange[]
  status: AgentItemStatus
}

/**
 * The file-change card's subtitle line. While streaming it reports the live
 * line/+/- counts derived from the partial args; once settled it reports the
 * applied-file diff stats (plus any failed-file count). Pure — mirrors the
 * branch logic that used to live inline in FileChangeCard.
 */
export function fileChangeSubtitle(args: FileChangeSubtitleArgs): string | undefined {
  const { streaming, isWrite, hasError, smoothedCode, rawContent, edits } = args
  if (streaming) {
    if (isWrite) {
      const lines = countLines(smoothedCode || rawContent)
      return lines > 0 ? `Writing… · ${lines} line${lines === 1 ? '' : 's'}` : 'Writing…'
    }
    const counts = countEditChanges(edits)
    return counts.additions + counts.deletions > 0
      ? `Editing… · +${counts.additions} -${counts.deletions}`
      : 'Editing…'
  }
  if (hasError) return 'Failed'
  const stats = sumDiffStats(args.appliedChanges)
  const a = args.appliedChanges.length
  const base =
    a > 0 && stats.additions + stats.deletions > 0
      ? `${a} file${a === 1 ? '' : 's'} · +${stats.additions} -${stats.deletions}`
      : statusLabel(args.status)
  return args.failedChanges.length > 0 ? `${base} · ${args.failedChanges.length} failed` : base
}

/** Last non-empty new_string in a (possibly partial) edits array — the code currently being typed. */
export function lastNewString(edits: unknown): string | undefined {
  if (!Array.isArray(edits)) return undefined
  const edit = findLast(edits, (value) => {
    if (!value || typeof value !== 'object') return false
    return (
      typeof (value as { new_string?: unknown }).new_string === 'string' &&
      Boolean((value as { new_string?: string }).new_string)
    )
  })
  return typeof edit === 'object' && edit && 'new_string' in edit
    ? (edit as { new_string?: string }).new_string
    : undefined
}

/** Last non-empty `content` in a (possibly partial) `files` array — the file being typed. */
export function lastContent(files: unknown): string | undefined {
  if (!Array.isArray(files)) return undefined
  const file = findLast(files, (value) => {
    if (!value || typeof value !== 'object') return false
    const content = (value as { content?: unknown }).content
    return typeof content === 'string' && Boolean(content)
  })
  return file ? (file as { content: string }).content : undefined
}
