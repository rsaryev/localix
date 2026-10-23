import { type ComponentType, type KeyboardEvent, useCallback, useState } from 'react'
import { Check, Minus, Plus, Undo2 } from 'lucide-react'
import { ActivitySignal } from '@localixai/kit/activity-orb'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import { DiffStat, VirtualDiff } from '@localixai/kit/diff'
import { IconButton } from '@localixai/kit/icon-button'
import { FLOATING_SURFACE } from '@localixai/kit/workbench-toolbar'
import type { LineStageMode } from '../../../backend/source-control/contracts'
import { changeKeys, useStagingDiff, type StagingOp } from '../model/useStagingDiff'

/**
 * Interactive staging diff with INLINE block actions. The diff is the host's `VirtualDiff` — unified or split, a
 * window of rows however large the file — and each contiguous CHANGE RUN reveals a
 * compact action bar at the viewport's right edge on hover: Stage / Discard on an
 * unstaged diff, Unstage on a staged one. The run IS the unit; its lines' raw-diff
 * indices are the payload of a drift-guarded partial `git apply` server-side
 * (backend/source-control/git/line-staging.ts).
 *   - `unstaged` (worktree vs index) → Stage / Discard a block, `s` / `d` for the file
 *   - `staged`   (index vs HEAD)     → Unstage a block, `u` for the file
 */
export function DiffStagingView({
  sessionId,
  path,
  mode,
  repoRoot,
  title,
}: {
  sessionId: string
  /** Repo-root-relative path (the git diff pathspec). */
  path: string
  mode: LineStageMode
  /** Target repo in a multi-root project; omitted → the session's primary repo. */
  repoRoot?: string
  title?: string
}) {
  const { data, doc, loading, busy, run } = useStagingDiff({ sessionId, path, mode, repoRoot })
  const [confirmDiscard, setConfirmDiscard] = useState<{ lines: number[]; label: string } | null>(
    null,
  )
  const staged = mode === 'staged'

  const runActions = useCallback(
    (runId: number) => {
      if (!doc) return null
      const block = doc.runs[runId]!
      const lines = changeKeys(doc, block.lineStart, block.lineEnd)
      return (
        <div className={`flex items-center gap-0.5 p-0.5 ${FLOATING_SURFACE}`}>
          {staged ? (
            <RunButton
              icon={Minus}
              title="Unstage this block"
              disabled={busy}
              onClick={() => void run('unstage', lines)}
            />
          ) : (
            <>
              <RunButton
                icon={Plus}
                title="Stage this block"
                disabled={busy}
                onClick={() => void run('stage', lines)}
              />
              <RunButton
                icon={Undo2}
                title="Discard this block (revert it from the working tree)"
                tone="danger"
                disabled={busy}
                onClick={() => setConfirmDiscard({ lines, label: 'this block' })}
              />
            </>
          )}
        </div>
      )
    },
    [doc, staged, busy, run],
  )

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!doc || confirmDiscard || event.target !== event.currentTarget) return
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    if (event.nativeEvent.isComposing) return
    const key = event.key.toLowerCase()
    const op: StagingOp | null =
      key === 's' && !staged ? 'stage' : key === 'u' && staged ? 'unstage' : null
    if (op) {
      event.preventDefault()
      void run(op, changeKeys(doc))
    } else if (key === 'd' && !staged) {
      event.preventDefault()
      setConfirmDiscard({ lines: changeKeys(doc), label: 'all changes in this file' })
    }
  }

  if (loading && !data) {
    return (
      <ActivitySignal
        label="Loading diff"
        className="min-h-0 flex-1 justify-center text-xs text-text-faint"
        labelClassName="min-w-0"
      />
    )
  }
  if (data?.binary || data?.truncated) {
    // A cut diff has no lines to offer: a patch built from it would stage against a hunk git
    // never finished printing (the backend returns none rather than a prefix).
    return (
      <div className="px-3 py-4 text-xs text-text-faint">
        {data.binary ? 'Binary file' : 'This diff is too large to stage by line'} — stage or discard
        the whole file instead.
      </div>
    )
  }
  if (!doc || doc.lines.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-4 text-xs text-text-faint">
        <Check className="size-3.5 text-status-success" /> No {staged ? 'staged ' : ''}
        changes in {title ?? 'this file'}.
      </div>
    )
  }

  const fileOp: StagingOp = staged ? 'unstage' : 'stage'
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <VirtualDiff
        doc={doc}
        ariaLabel={
          staged
            ? 'Staged diff — hover a change block to unstage it, u unstages the file'
            : 'Diff — hover a change block to stage or discard it, s stages and d discards the file'
        }
        lead={
          <>
            <span>{staged ? 'Staged changes' : 'Working tree changes'}</span>
            <DiffStat additions={doc.additions} deletions={doc.deletions} />
          </>
        }
        actions={
          <RunButton
            icon={staged ? Minus : Plus}
            title={
              staged ? 'Unstage all changes in this file (u)' : 'Stage all changes in this file (s)'
            }
            disabled={busy}
            onClick={() => void run(fileOp, changeKeys(doc))}
          />
        }
        runActions={runActions}
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1"
      />
      <ConfirmDialog
        open={confirmDiscard !== null}
        variant="destructive"
        title="Discard changes?"
        description={
          confirmDiscard
            ? `Discard ${confirmDiscard.label} from the working tree? These changes are removed from the file on disk — this cannot be undone.`
            : ''
        }
        confirmLabel="Discard"
        onConfirm={() => {
          if (confirmDiscard) void run('discard', confirmDiscard.lines)
          setConfirmDiscard(null)
        }}
        onClose={() => setConfirmDiscard(null)}
      />
    </div>
  )
}

/** Compact icon-only button in the inline run-action bar. */
function RunButton({
  icon: Icon,
  title,
  onClick,
  disabled,
  tone = 'neutral',
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  onClick: () => void
  disabled?: boolean
  tone?: 'neutral' | 'danger'
}) {
  return (
    <IconButton
      size="xs"
      tooltip={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      tone={tone === 'danger' ? 'danger' : 'default'}
    >
      <Icon className="size-3.5" />
    </IconButton>
  )
}
