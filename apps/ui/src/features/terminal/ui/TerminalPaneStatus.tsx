import { ActivitySignal } from '@localixai/kit/activity-orb'
import { StateNotice } from '@localixai/kit/state-notice'
import { PaneStateOverlay } from '@localixai/kit/pane-state-overlay'
import { Button } from '@localixai/kit/button'
import { ProblemLine, type useProblemReport } from '@/shared/ui/problem-report'
import { baseName } from '@localixai/mini-app-sdk/ui/utilities'
import type { TerminalFolderMove } from '../model/terminalFolderMove'

/** Sticky-scroll header: the command whose prompt scrolled off the top; click jumps back. */
export function TerminalStickyCommand({ text, onJump }: { text: string; onJump: () => void }) {
  return (
    <button
      type="button"
      onClick={onJump}
      title={`Running command — click to jump to its prompt\n${text}`}
      aria-label={`Sticky command: ${text}. Click to jump to its prompt.`}
      // No `backdrop-blur-sm`: the 95% fill already hides the scrollback behind
      // this pill, while the filter would re-sample the backdrop on every frame
      // of a fast terminal scroll.
      className="focus-ring lx-occluder absolute inset-x-0 top-0 z-(--z-raised) flex items-center gap-1.5 border-b border-border-soft px-2 py-0.5 text-left font-mono text-xs text-text-soft hover:text-foreground"
    >
      <span className="shrink-0 select-none text-2xs text-text-soft">↳</span>
      <span className="truncate">{text}</span>
    </button>
  )
}

/** Reconnecting / disconnected overlays for a live (not exited) terminal. */
export function TerminalConnectionState({
  reconnecting,
  dead,
  problem,
  onRecover,
}: {
  reconnecting: boolean
  dead: string | null
  problem: ReturnType<typeof useProblemReport>
  onRecover: () => void
}) {
  if (dead) {
    return (
      <PaneStateOverlay material="subtle" className="pointer-events-none z-(--z-controls)">
        <StateNotice
          className="pointer-events-auto max-w-sm flex-none"
          title="Terminal disconnected"
          body={problem && <ProblemLine {...problem} className="items-center" />}
          actionsLabel="Terminal recovery actions"
          actions={
            <Button type="button" variant="ghost" size="sm" onClick={onRecover}>
              New terminal
            </Button>
          }
        />
      </PaneStateOverlay>
    )
  }
  if (!reconnecting) return null
  return (
    <PaneStateOverlay className="pointer-events-none z-(--z-controls)">
      <ActivitySignal
        label="Reconnecting"
        className="text-xs text-text-soft"
        labelClassName="min-w-0"
      />
    </PaneStateOverlay>
  )
}

/**
 * The project this shell started in was pointed at another folder: the shell is still in the old
 * path, which is gone. Said once, at the top, and the restart opens a shell at the same place in
 * the new folder; nothing restarts on its own, since the shell may be running something.
 */
export function TerminalFolderMoved({
  moved,
  onRestart,
}: {
  moved: TerminalFolderMove
  onRestart: () => void
}) {
  return (
    <div
      role="status"
      className="absolute inset-x-0 top-0 z-(--z-controls) flex items-center gap-2 border-b border-border-soft bg-popover px-2 py-1 text-xs text-text-soft"
    >
      <span className="min-w-0 flex-1 truncate">
        This terminal is still in {moved.from}, which moved to {moved.to}.
      </span>
      <Button type="button" variant="secondary" size="sm" title={moved.cwd} onClick={onRestart}>
        Restart in “{baseName(moved.to)}”
      </Button>
    </div>
  )
}
