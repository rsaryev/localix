import { memo } from 'react'
import { GitCompareArrows, Sparkles } from 'lucide-react'
import type { BisectTerm, RepoCommit, ResetMode } from '../../../backend/source-control/contracts'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { copyText } from '@localixai/plugin-sdk/ui/interactions'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@localixai/kit/context-menu'
import type { assignCommitLanes } from '../model/commitLanes'
import { CommitRail, RefChips } from './commitGraphParts'

/** Everything a commit row can ask the graph to do. One stable dispatcher carries them all. */
export type CommitAction =
  | { kind: 'select' }
  | { kind: 'mark' }
  | { kind: 'clearMark' }
  | { kind: 'compare' }
  | { kind: 'checkout' }
  | { kind: 'branchHere' }
  | { kind: 'revert' }
  | { kind: 'cherryPick' }
  | { kind: 'rebaseFrom' }
  | { kind: 'reword' }
  | { kind: 'fixup' }
  | { kind: 'rebaseOnto' }
  | { kind: 'bisectStart' }
  | { kind: 'bisectMark'; term: BisectTerm }
  | { kind: 'reset'; mode: ResetMode }

export type CommitDispatch = (action: CommitAction, commit: RepoCommit, index: number) => void

type LaneRow = ReturnType<typeof assignCommitLanes>[number]

interface CommitRowProps {
  commit: RepoCommit
  index: number
  /** The lane rail for this row; absent under a filter (parents fall outside the set). */
  laneRow: LaneRow | undefined
  railWidth: number
  isLast: boolean
  isBase: boolean
  /** Short sha of the commit marked for compare, when one is (and it is not this one). */
  markedShortHash: string | null
  /** Compare is offered by the host view. */
  canCompare: boolean
  busy: boolean
  /** A bisect is underway; `bisectHere` = this commit is the one under test. */
  bisecting: boolean
  bisectHere: boolean
  dispatch: CommitDispatch
}

/**
 * One commit of the graph: rail, refs, subject, meta — and its right-click menu of commit-level
 * operations. Memoized with primitive props and one stable `dispatch`, so a `busy` flip or a
 * compare mark re-renders the rows it concerns, not all forty.
 */
export const CommitRow = memo(function CommitRow(props: CommitRowProps) {
  const { commit: c, index: i, laneRow, isBase, busy, dispatch } = props
  const act = (action: CommitAction) => () => dispatch(action, c, i)
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          onClick={act({ kind: 'select' })}
          title={`${c.shortHash} — ${c.subject}`}
          className={cn(
            'flex w-full items-stretch gap-2 px-3 text-left transition-colors hover:bg-surface-hover/60 focus-visible:bg-surface-hover/60 focus-visible:outline-none',
            // 7% veil, not `bg-accent/5`: `accent` is itself a 6% veil under glass, so `/5` of
            // it was a 0.3% fill — the base-commit marker was invisible.
            isBase && 'bg-surface-hover',
          )}
        >
          {laneRow ? (
            <CommitRail row={laneRow} laneCount={props.railWidth} isBase={isBase} />
          ) : (
            <span className="relative flex w-3 shrink-0 justify-center">
              <span
                className={cn(
                  // `text-faint` as a real colour, not `bg-accent`: under glass `accent` is a
                  // 6% foreground VEIL, and a 4px dot painted with a 6% veil is invisible —
                  // the graph lost its commit markers.
                  'z-(--z-raised) mt-[6px] size-2 shrink-0 rounded-full border-2 border-background bg-text-faint',
                  isBase && 'ring-2 ring-control-border-focus',
                )}
              />
              {!props.isLast && (
                <span className="absolute left-1/2 top-[6px] h-full w-px -translate-x-1/2 bg-border" />
              )}
            </span>
          )}
          <div className="min-w-0 flex-1 py-0.5">
            <div className="flex min-w-0 items-center gap-1 text-xs text-text-soft">
              {c.refs && c.refs.length > 0 && <RefChips refs={c.refs} />}
              <span className="min-w-0 truncate">{c.subject}</span>
              {isBase && (
                // Foreground veil, not `bg-accent/15`: `accent` is itself a 6% veil under
                // glass, so `/15` of it was a 0.9% fill — the "base" badge had no chip at all.
                <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-foreground/[0.06] px-1 text-2xs font-medium text-foreground">
                  <GitCompareArrows className="size-2.5" /> base
                </span>
              )}
              {c.hasNote && (
                <Sparkles
                  className="size-3 shrink-0 text-text-faint"
                  aria-label="Agent provenance available"
                />
              )}
            </div>
            <div className="truncate text-2xs text-text-faint">
              {c.shortHash} · {c.author}
              {c.relativeDate ? ` · ${c.relativeDate}` : ''}
            </div>
          </div>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {props.canCompare && (
          <>
            {isBase ? (
              <ContextMenuItem onSelect={act({ kind: 'clearMark' })}>
                Clear compare mark
              </ContextMenuItem>
            ) : props.markedShortHash ? (
              <>
                <ContextMenuItem onSelect={act({ kind: 'compare' })}>
                  Compare with marked ({props.markedShortHash})
                </ContextMenuItem>
                <ContextMenuItem onSelect={act({ kind: 'mark' })}>
                  Mark commit for compare
                </ContextMenuItem>
                <ContextMenuItem onSelect={act({ kind: 'clearMark' })}>
                  Clear compare mark
                </ContextMenuItem>
              </>
            ) : (
              <ContextMenuItem onSelect={act({ kind: 'mark' })}>
                Mark commit for compare
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem disabled={busy} onSelect={act({ kind: 'checkout' })}>
          Checkout commit
        </ContextMenuItem>
        <ContextMenuItem disabled={busy} onSelect={act({ kind: 'branchHere' })}>
          New branch here…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={busy} onSelect={act({ kind: 'revert' })}>
          Revert commit
        </ContextMenuItem>
        <ContextMenuItem disabled={busy} onSelect={act({ kind: 'cherryPick' })}>
          Cherry-pick onto current branch
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={busy} onSelect={act({ kind: 'rebaseFrom' })}>
          Rebase interactively from here…
        </ContextMenuItem>
        <ContextMenuItem disabled={busy} onSelect={act({ kind: 'reword' })}>
          Reword message…
        </ContextMenuItem>
        <ContextMenuItem disabled={busy} onSelect={act({ kind: 'fixup' })}>
          Fixup staged changes into this commit
        </ContextMenuItem>
        <ContextMenuItem disabled={busy} onSelect={act({ kind: 'rebaseOnto' })}>
          Rebase current branch onto this
        </ContextMenuItem>
        <ContextMenuSeparator />
        {props.bisecting ? (
          props.bisectHere ? (
            <>
              <ContextMenuItem disabled={busy} onSelect={act({ kind: 'bisectMark', term: 'bad' })}>
                Bisect · mark BAD (broken here)
              </ContextMenuItem>
              <ContextMenuItem disabled={busy} onSelect={act({ kind: 'bisectMark', term: 'good' })}>
                Bisect · mark GOOD (works here)
              </ContextMenuItem>
              <ContextMenuItem disabled={busy} onSelect={act({ kind: 'bisectMark', term: 'skip' })}>
                Bisect · skip (can't test)
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          ) : null
        ) : (
          <>
            <ContextMenuItem disabled={busy} onSelect={act({ kind: 'bisectStart' })}>
              Start bisect — mark this commit BAD
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem disabled={busy} onSelect={act({ kind: 'reset', mode: 'soft' })}>
          Reset — soft (keep changes staged)
        </ContextMenuItem>
        <ContextMenuItem disabled={busy} onSelect={act({ kind: 'reset', mode: 'mixed' })}>
          Reset — mixed (keep changes unstaged)
        </ContextMenuItem>
        <ContextMenuItem
          disabled={busy}
          onSelect={act({ kind: 'reset', mode: 'hard' })}
          tone="danger"
        >
          Reset — hard (discard changes)
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void copyText(c.hash, 'SHA')}>Copy SHA</ContextMenuItem>
        <ContextMenuItem onSelect={() => void copyText(c.subject, 'Commit message')}>
          Copy message
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
})
