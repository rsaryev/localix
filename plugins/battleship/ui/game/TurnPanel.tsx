import { Anchor, CircleAlert, Crosshair, Flag, RefreshCw, RotateCcw, Trophy } from 'lucide-react'
import { ActivityOrb } from '@localixai/kit/activity-orb'
import { Button } from '@localixai/kit/button'
import { cn } from '@localixai/plugin-sdk/ui/classes'

import { owesAgentShot, type PlayerView } from '../../shared/game'
import { announcement, elapsed, headline, nextOpener, scoreLine, shotSentence } from './copy'

/** After this long without the agent's shot, the status offers to ask it again. */
export const PATIENCE_MS = 30_000

/**
 * Two surfaces for the game's state, so nothing sits between the boards:
 *
 * - {@link TurnStatus} — whose shot, the last shot fired, the score at this table, how long the
 *   agent has been aiming, and the way out of a wait that stalled.
 * - {@link GameOver} — the card that rises when a game ends, with the result and the next game.
 *   The boards stay visible behind it, and the agent's whole fleet is shown on them.
 *
 * Nothing here counts: the time the agent has been aiming is `now` against the moment it was
 * asked, so a hidden pane loses nothing.
 */
export function TurnStatus({
  view,
  now,
  error,
  sending,
  onRemind,
}: {
  view: PlayerView
  now: number
  error: string | null
  sending: boolean
  onRemind: () => void
}) {
  const agentTurn = owesAgentShot(view)
  const waiting = view.waiting
  const thinkingFor = waiting ? now - Date.parse(waiting.since) : 0
  const thinking = agentTurn && (waiting === null || waiting.status === 'thinking')
  const stuck = agentTurn && (!thinking || thinkingFor >= PATIENCE_MS)
  const suffix = thinking && waiting ? ` · ${elapsed(thinkingFor)}` : ''
  const last = view.shots.at(-1)

  return (
    // Reserve space for recovery actions before they appear, so the boards do not move on a stall.
    <div className="flex min-h-20 min-w-40 flex-1 flex-col items-start justify-center gap-1">
      <p
        role={error ? 'alert' : undefined}
        className={cn(
          'flex items-center gap-2 text-base font-medium',
          error ? 'text-status-warning' : 'text-text-soft',
        )}
      >
        {!error && view.status === 'playing' && <StateIcon view={view} thinking={thinking} />}
        <span className={cn(!error && 'text-foreground')}>{error ?? headline(view)}</span>
        {!error && suffix && (
          <span className="font-mono tabular-nums text-text-faint">{suffix}</span>
        )}
      </p>
      {/* The last thing that happened, so a glance tells the story; the tallies show the rest. */}
      <p className="text-xs text-text-faint">
        {last ? shotSentence(last) : 'Fleets are placed — fire at the agent’s waters.'}
        {scoreLine(view.record)}
      </p>
      {/* Heard, not seen: the shot just fired and what it means, once per change. */}
      <p aria-live="polite" className="sr-only">
        {announcement(view)}
      </p>
      {stuck && (
        <Button size="sm" variant="secondary" onClick={onRemind} disabled={sending}>
          <RefreshCw data-icon="inline-start" />
          Ask again
        </Button>
      )}
    </div>
  )
}

export function GameOver({
  view,
  sending,
  onNewGame,
}: {
  view: PlayerView
  sending: boolean
  onNewGame: () => void
}) {
  if (view.status === 'playing') return null
  const won = view.status === 'won'
  const Icon = won ? Trophy : Flag
  const title = headline(view)
  return (
    <div className="battleship-over pointer-events-none absolute inset-0 z-(--z-raised) flex items-center justify-center">
      <div
        role="dialog"
        aria-label={title}
        className="pointer-events-auto flex w-[min(90%,20rem)] flex-col items-center gap-3 rounded-xl border border-border-soft bg-popover/90 px-6 py-5 text-center shadow-(--shadow-popover) backdrop-blur-md"
      >
        <Icon
          className={cn('size-7', won ? 'text-status-success' : 'text-text-soft')}
          aria-hidden
        />
        <div className="space-y-1">
          <h2 className={cn('text-lg font-semibold tracking-tight', won && 'text-status-success')}>
            {title}
          </h2>
          <p className="text-xs text-text-soft">
            {won ? 'The agent’s whole fleet is sunk.' : 'Your whole fleet is sunk.'} Next:{' '}
            {nextOpener(view)}.
          </p>
        </div>
        <Button variant="mono" size="lg" onClick={onNewGame} disabled={sending} autoFocus>
          <RotateCcw data-icon="inline-start" />
          New game
        </Button>
      </div>
    </div>
  )
}

function StateIcon({ view, thinking }: { view: PlayerView; thinking: boolean }) {
  const icon = 'size-4 shrink-0'
  if (view.turn === 'you') return <Crosshair className={cn(icon, 'text-(--chart-2)')} aria-hidden />
  if (thinking) return <ActivityOrb className="size-4" />
  if (view.waiting?.status === 'unreachable')
    return <CircleAlert className={cn(icon, 'text-status-warning')} aria-hidden />
  return <Anchor className={cn(icon, 'text-text-soft')} aria-hidden />
}
