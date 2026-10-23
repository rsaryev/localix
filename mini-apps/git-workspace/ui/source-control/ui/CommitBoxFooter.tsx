import { GitCommitVertical } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

/** Subject length past which the hint appears, and past which it turns red (50/72). */
const SUBJECT_SOFT = 50
const SUBJECT_HARD = 72

/** The line under the commit field: the Amend toggle and the subject-length hint. */
export function CommitBoxFooter({
  canAmend,
  amend,
  committing,
  subjectLen,
  onToggleAmend,
}: {
  canAmend: boolean
  amend: boolean
  committing: boolean
  subjectLen: number
  onToggleAmend: () => void
}) {
  const showHint = subjectLen > SUBJECT_SOFT
  if (!canAmend && !showHint) return null
  return (
    <div className="mt-1 flex items-center justify-between gap-2 px-0.5">
      {canAmend ? (
        <button
          type="button"
          onClick={onToggleAmend}
          aria-pressed={amend}
          disabled={committing}
          title="Rewrite the last commit instead of creating a new one"
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-medium transition-colors',
            amend
              ? // 11% veil, not `bg-accent/15`: `accent` is itself a 6% veil under glass, so
                // `/15` of it was 0.9% — the pressed state read weaker than its own hover.
                'bg-surface-active text-foreground'
              : 'text-text-faint hover:bg-surface-hover hover:text-text-soft',
          )}
        >
          <GitCommitVertical className="size-3" />
          Amend last commit
        </button>
      ) : (
        <span />
      )}
      {showHint && (
        <span
          className={cn(
            'text-2xs tabular-nums',
            subjectLen > SUBJECT_HARD ? 'text-status-error' : 'text-status-warning',
          )}
          title="Keep the commit subject under 50 chars (72 max)"
        >
          {subjectLen}
        </span>
      )}
    </div>
  )
}
