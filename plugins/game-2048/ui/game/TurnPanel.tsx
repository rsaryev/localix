import { CircleAlert, CircleX, Play, RotateCcw, Trophy, User } from 'lucide-react'
import { ActivityOrb } from '@localixai/kit/activity-orb'
import { Button } from '@localixai/kit/button'
import { cn } from '@localixai/plugin-sdk/ui/classes'

import { agentPlays, type Game } from '../../shared/game'
import { announcement, elapsed, headline, mayRemind, resultLine, scoreLine } from './copy'

/**
 * After this long without an agent move, the status offers to ask it again. Longer than the other
 * games' 20s: the agent plays many calls in one turn, and one slow model call is not a stall.
 */
export const PATIENCE_MS = 45_000

/**
 * Two surfaces for the game's state, so nothing sits under the board — the same pair as the other
 * games:
 *
 * - {@link TurnStatus} — beside the controls: who is playing, the score, how long since the
 *   agent's last move, and the way back into a game the agent stopped playing.
 * - {@link GameOver} — the card that rises over the board when a game ends. The board stays
 *   visible behind it, so the final position is part of the result.
 *
 * Nothing here counts: the time since the agent's last move is `now` against the moment it moved.
 */
export function TurnStatus({
  game,
  now,
  error,
  sending,
  onRemind,
}: {
  game: Game
  now: number
  error: string | null
  sending: boolean
  onRemind: () => void
}) {
  const playing = agentPlays(game) && game.waiting?.status === 'thinking'
  const suffix = playing ? ` · ${elapsed(now - Date.parse(game.waiting!.since))}` : ''
  return (
    // Reserve space for the recovery action before it appears, so the board does not move.
    <div className="flex min-h-20 min-w-40 flex-1 flex-col items-start justify-center gap-1">
      <p
        role={error ? 'alert' : undefined}
        className={cn(
          'flex items-center gap-2 text-base font-medium',
          error ? 'text-status-warning' : 'text-text-soft',
        )}
      >
        {!error && game.status === 'playing' && <StateIcon game={game} />}
        <span className={cn(!error && 'text-foreground')}>{error ?? headline(game)}</span>
        {!error && suffix && (
          <span className="font-mono tabular-nums text-text-faint">{suffix}</span>
        )}
      </p>
      <p className="font-mono text-xs tabular-nums text-text-faint">{scoreLine(game)}</p>
      {/* Heard, not seen: the move just made and what it means, once per change. */}
      <p aria-live="polite" className="sr-only">
        {announcement(game)}
      </p>
      {mayRemind(game, now, PATIENCE_MS) && (
        <Button size="sm" variant="secondary" onClick={onRemind} disabled={sending}>
          <Play data-icon="inline-start" />
          Continue
        </Button>
      )}
    </div>
  )
}

function StateIcon({ game }: { game: Game }) {
  const icon = 'size-4 shrink-0'
  if (game.mode === 'user') return <User className={cn(icon, 'text-text-soft')} aria-hidden />
  if (game.waiting?.status === 'unreachable')
    return <CircleAlert className={cn(icon, 'text-status-warning')} aria-hidden />
  return <ActivityOrb className="size-4" />
}

export function GameOver({
  game,
  sending,
  onNewGame,
}: {
  game: Game
  sending: boolean
  onNewGame: () => void
}) {
  if (game.status === 'playing') return null
  const won = game.status === 'won'
  const Icon = won ? Trophy : CircleX
  const title = headline(game)
  return (
    <div className="game-2048-over pointer-events-none absolute inset-0 z-(--z-raised) flex items-center justify-center">
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
          <p className="text-xs text-text-soft">{resultLine(game)}</p>
        </div>
        <Button variant="mono" size="lg" onClick={onNewGame} disabled={sending} autoFocus>
          <RotateCcw data-icon="inline-start" />
          New game
        </Button>
      </div>
    </div>
  )
}
