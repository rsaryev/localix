import { CircleAlert, CircleX, Keyboard, Play, RotateCcw, Square, Trophy } from 'lucide-react'
import { ActivityOrb } from '@localixai/kit/activity-orb'
import { Button } from '@localixai/kit/button'
import { cn } from '@localixai/plugin-sdk/ui/classes'

import { modelPlays, type Game } from '../../shared/game'
import { announcement, headline, mayContinue, resultLine, scoreLine, spokenHeadline } from './copy'

/**
 * Two surfaces for the game's state, so nothing sits under the board — the same pair as the other
 * games: {@link TurnStatus} beside the controls (the state, the score, Stop or Continue while the
 * model plays) and {@link GameOver}, the card that rises over the board when the game ends.
 */
export function TurnStatus({
  game,
  running,
  error,
  sending,
  onContinue,
  onStop,
}: {
  game: Game
  /** The person's snake is moving now. */
  running: boolean
  error: string | null
  sending: boolean
  onContinue: () => void
  onStop: () => void
}) {
  const playing = modelPlays(game) && game.waiting?.status === 'thinking'
  const reason = modelPlays(game) && game.waiting?.status === 'unreachable' && game.waiting.reason
  return (
    // Sized by its content, so a narrow pane wraps the controls below it instead of over it.
    <div className="flex min-h-20 flex-auto flex-col items-start justify-center gap-1">
      <p
        role={error ? 'alert' : undefined}
        className={cn(
          'flex items-center gap-2 text-base font-medium whitespace-nowrap',
          error ? 'text-status-warning' : 'text-foreground',
        )}
      >
        {!error && game.status === 'playing' && <StateIcon game={game} />}
        <span>{error ?? headline(game, running)}</span>
      </p>
      <p className="font-mono text-xs whitespace-nowrap tabular-nums text-text-faint">
        {scoreLine(game)}
      </p>
      {reason && <p className="text-xs text-status-warning">{reason}</p>}
      <p aria-live="polite" className="sr-only">
        {running ? '' : announcement(game)}
      </p>
      {playing && (
        <Button size="sm" variant="secondary" onClick={onStop} disabled={sending}>
          <Square data-icon="inline-start" />
          Stop
        </Button>
      )}
      {mayContinue(game) && (
        <Button size="sm" variant="secondary" onClick={onContinue} disabled={sending}>
          <Play data-icon="inline-start" />
          Continue
        </Button>
      )}
    </div>
  )
}

function StateIcon({ game }: { game: Game }) {
  const icon = 'size-4 shrink-0'
  if (game.mode === 'user') return <Keyboard className={cn(icon, 'text-text-soft')} aria-hidden />
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
  const title = spokenHeadline(game)
  return (
    <div className="snake-over pointer-events-none absolute inset-0 z-(--z-raised) flex items-center justify-center">
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
