import { Anchor, CircleAlert, Crosshair, Flag, RefreshCw, RotateCcw, Trophy } from 'lucide-react'
import { ActivityOrb } from '@localixai/kit/activity-orb'
import { Button } from '@localixai/kit/button'
import { GameProblem, GameStatus } from '@localixai/kit/game-status'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { OTHER_OPPONENT } from '@localixai/mini-app-sdk/opponent'

import { owesAgentShot, type Opponent, type PlayerView } from '../../shared/game'
import {
  announcement,
  elapsed,
  headline,
  nextOpener,
  opponentName,
  scoreLine,
  shotSentence,
} from './copy'

/** After this long without the agent's shot, the board offers to ask it again. */
export const PATIENCE_MS = 30_000

/**
 * Three surfaces for the game's state, none of them between the boards and none that moves them:
 *
 * - {@link TurnStatus} — the two lines beside the controls: whose shot, how long the agent has been
 *   aiming, and the last shot fired with the score at this table.
 * - {@link TurnProblem} — what stopped the game, over the top of the boards: a failed request, an
 *   opponent that did not answer, a shot that is taking too long, each with its way out.
 * - {@link GameOver} — the card that rises when a game ends, with the result and the next game.
 *   The boards stay visible behind it, and the agent's whole fleet is shown on them.
 *
 * Nothing here counts: the time the agent has been aiming is `now` against the moment it was
 * asked, so a hidden pane loses nothing.
 */
export function TurnStatus({ view, now }: { view: PlayerView; now: number }) {
  const waiting = view.waiting
  const thinking = owesAgentShot(view) && (waiting === null || waiting.status === 'thinking')
  const last = view.shots.at(-1)
  return (
    <>
      <GameStatus
        icon={view.status === 'playing' && <StateIcon view={view} thinking={thinking} />}
        title={headline(view)}
        suffix={thinking && waiting ? `· ${elapsed(now - Date.parse(waiting.since))}` : undefined}
        // The last thing that happened, so a glance tells the story; the tallies show the rest.
        detail={`${last ? shotSentence(last, view) : 'Fleets are placed — fire at the agent’s waters.'}${scoreLine(view.record)}`}
      />
      {/* Heard, not seen: the shot just fired and what it means, once per change. */}
      <p aria-live="polite" className="sr-only">
        {announcement(view)}
      </p>
    </>
  )
}

export function TurnProblem({
  view,
  now,
  error,
  sending,
  onRetry,
  onRemind,
  onOpponent,
}: {
  view: PlayerView
  now: number
  error: string | null
  sending: boolean
  onRetry: () => void
  onRemind: () => void
  onOpponent: (opponent: Opponent) => void
}) {
  if (error)
    return (
      <GameProblem
        title={error}
        actions={
          <Button size="sm" variant="secondary" onClick={onRetry}>
            <RefreshCw data-icon="inline-start" />
            Retry
          </Button>
        }
      />
    )
  if (!owesAgentShot(view)) return null
  const waiting = view.waiting
  const askAgain = (
    <Button size="sm" variant="secondary" onClick={onRemind} disabled={sending}>
      <RefreshCw data-icon="inline-start" />
      Ask again
    </Button>
  )
  if (waiting?.status === 'unreachable') {
    const other = OTHER_OPPONENT[view.opponent ?? 'agent']
    return (
      <GameProblem
        title={`${opponentName(view)} did not fire`}
        description={waiting.reason}
        actions={
          <>
            {askAgain}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onOpponent(other.opponent)}
              disabled={sending}
            >
              {other.label}
            </Button>
          </>
        }
      />
    )
  }
  if (waiting === null || now - Date.parse(waiting.since) < PATIENCE_MS) return null
  return (
    <GameProblem
      role="status"
      title={`${opponentName(view)} is taking a while`}
      description="Ask again to wake it, or keep waiting."
      actions={askAgain}
    />
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
