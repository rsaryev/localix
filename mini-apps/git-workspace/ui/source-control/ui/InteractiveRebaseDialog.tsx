import { useMemo, useState } from 'react'
import { ArrowUp, ArrowDown, GitBranchPlus } from 'lucide-react'
import type {
  RebaseAction,
  RebaseTodoEntry,
  RepoCommit,
} from '../../../backend/source-control/contracts'
import { Input } from '@localixai/kit/input'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@localixai/kit/dialog'
import { Select } from '@localixai/kit/select'
import { Button } from '@localixai/kit/button'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

interface Row {
  commit: RepoCommit
  action: RebaseAction
  /** New message for a `reword` row (prefilled with the subject). */
  message: string
}

const ACTION_OPTIONS: { value: RebaseAction; label: string }[] = [
  { value: 'pick', label: 'Pick' },
  { value: 'reword', label: 'Reword' },
  { value: 'squash', label: 'Squash — into previous (keep both messages)' },
  { value: 'fixup', label: 'Fixup — into previous (drop this message)' },
  { value: 'drop', label: 'Drop' },
]

/**
 * The interactive-rebase todo editor. Given the commits from a chosen commit up
 * to HEAD, the user assigns each an action (pick / reword / squash / fixup /
 * drop) and reorders rows (↑/↓). Rows are shown in APPLY order — top = applied
 * first = oldest. On Apply we send the composed todo to `onApply`, which runs a
 * NON-interactive `git rebase -i` server-side. History rewrites are confirmed by
 * the very act of applying; the caller refuses on a dirty tree.
 */
export function InteractiveRebaseDialog({
  open,
  fromHash,
  commitsNewestFirst,
  branch,
  onApply,
  onClose,
}: {
  open: boolean
  /** The oldest commit in range — the rebase replays onto its parent. */
  fromHash: string
  /** Commits in the selected range, newest first (as the graph lists them). */
  commitsNewestFirst: RepoCommit[]
  /** Current branch name for the header, when known. */
  branch: string | null
  onApply: (fromHash: string, entries: RebaseTodoEntry[]) => void
  onClose: () => void
}) {
  // Apply order is oldest-first — reverse the newest-first graph slice.
  const initial = useMemo<Row[]>(
    () =>
      [...commitsNewestFirst]
        .reverse()
        .map((commit) => ({ commit, action: 'pick' as RebaseAction, message: commit.subject })),
    [commitsNewestFirst],
  )
  const [rows, setRows] = useState<Row[]>(initial)

  // Re-seed when the target range changes (dialog reused across right-clicks).
  const [seed, setSeed] = useState(fromHash)
  if (seed !== fromHash) {
    setSeed(fromHash)
    setRows(initial)
  }

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    setRows((r) => {
      const next = [...r]
      ;[next[i], next[j]] = [next[j]!, next[i]!]
      return next
    })
  }

  const setAction = (i: number, action: RebaseAction) =>
    setRows((r) => r.map((row, k) => (k === i ? { ...row, action } : row)))
  const setMessage = (i: number, message: string) =>
    setRows((r) => r.map((row, k) => (k === i ? { ...row, message } : row)))

  const kept = rows.filter((r) => r.action !== 'drop')
  const firstKept = kept[0]
  const firstKeptIsFold = firstKept?.action === 'squash' || firstKept?.action === 'fixup'
  const rewordMissing = rows.some((r) => r.action === 'reword' && !r.message.trim())
  const noChange = rows.every(
    (r, i) => r.commit.hash === initial[i]?.commit.hash && r.action === 'pick',
  )
  const error =
    kept.length === 0
      ? 'A rebase must keep at least one commit.'
      : firstKeptIsFold
        ? 'The first kept commit cannot be a squash/fixup — nothing precedes it to fold into.'
        : rewordMissing
          ? 'A reworded commit needs a non-empty message.'
          : null

  const apply = () => {
    if (error) return
    const entries: RebaseTodoEntry[] = rows.map((r) => ({
      hash: r.commit.hash,
      action: r.action,
      ...(r.action === 'reword' ? { message: r.message } : {}),
    }))
    onApply(fromHash, entries)
    onClose()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
    >
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranchPlus className="size-4 text-foreground" />
            Interactive rebase{branch ? ` · ${branch}` : ''}
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="grid gap-3 pr-1">
          <p className="text-2xs text-text-faint">
            {rows.length} commit{rows.length === 1 ? '' : 's'} · top is applied first (oldest).
            Reorder with ↑/↓ and set each action. This rewrites history and cannot be undone once
            conflicts are resolved.
          </p>

          <ul className="max-h-[50vh] overflow-auto scrollbar-thin">
            {rows.map((row, i) => {
              const dropped = row.action === 'drop'
              const fold = row.action === 'squash' || row.action === 'fixup'
              return (
                <li
                  key={row.commit.hash}
                  className={cn(
                    'flex flex-col gap-1 rounded-md px-1.5 py-1.5',
                    fold && 'ml-4',
                    dropped && 'opacity-45',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex shrink-0 flex-col">
                      <button
                        type="button"
                        aria-label="Move up"
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                        className="rounded-sm text-text-faint outline-none transition-colors hover:text-foreground focus-ring disabled:opacity-25"
                      >
                        <ArrowUp className="size-3" />
                      </button>
                      <button
                        type="button"
                        aria-label="Move down"
                        disabled={i === rows.length - 1}
                        onClick={() => move(i, 1)}
                        className="rounded-sm text-text-faint outline-none transition-colors hover:text-foreground focus-ring disabled:opacity-25"
                      >
                        <ArrowDown className="size-3" />
                      </button>
                    </div>
                    <Select
                      size="md"
                      aria-label={`Action for ${row.commit.shortHash}`}
                      value={row.action}
                      onValueChange={(v) => setAction(i, v as RebaseAction)}
                      options={ACTION_OPTIONS}
                      className="w-24 shrink-0"
                      contentClassName="w-72"
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn('truncate text-xs text-text-soft', dropped && 'line-through')}
                      >
                        {row.commit.subject}
                      </div>
                      <div className="truncate text-2xs text-text-faint">
                        {row.commit.shortHash} · {row.commit.author}
                      </div>
                    </div>
                  </div>
                  {row.action === 'reword' && (
                    <Input
                      autoFocus
                      value={row.message}
                      spellCheck={false}
                      placeholder="New commit message…"
                      onChange={(e) => setMessage(i, e.target.value)}
                      // The `--input` veil, not `bg-background`: that is the WINDOW ground — denser
                    />
                  )}
                </li>
              )
            })}
          </ul>

          {error && <p className="text-2xs text-status-error">{error}</p>}
        </DialogBody>

        <DialogFooter>
          <Button
            variant="outline"
            size="xl"
            className="rounded-lg text-text-soft"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            variant="mono"
            size="xl"
            className="rounded-lg"
            disabled={!!error || noChange}
            onClick={apply}
          >
            Start rebase
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
