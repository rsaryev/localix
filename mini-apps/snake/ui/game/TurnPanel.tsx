import {
  CircleAlert,
  CircleX,
  Keyboard,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  Trophy,
} from 'lucide-react'
import { ActivityOrb } from '@localixai/kit/activity-orb'
import { Button } from '@localixai/kit/button'
import { GameProblem, GameStatus } from '@localixai/kit/game-status'
import { IconButton } from '@localixai/kit/icon-button'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

import { modelPlays, stopped, type Game } from '../../shared/game'
import { announcement, headline, mayContinue, resultLine, scoreLine, spokenHeadline } from './copy'

/**
 * The game's state on the same surfaces as the other games, none of them under the board and none
 * that moves it: {@link TurnStatus} (the state and the score) and {@link PlayToggle} in the control
 * row, {@link TurnProblem} over the top of the board when the model stopped on its own, and
 * {@link GameOver}, the card that rises over the board when the game ends.
 */
export function TurnStatus({
  game,
  running,
}: {
  game: Game
  /** The person's snake is moving now. */
  running: boolean
}) {
  return (
    <>
      <GameStatus
        icon={game.status === 'playing' && <StateIcon game={game} />}
        title={headline(game, running)}
        detail={scoreLine(game)}
      />
      <p aria-live="polite" className="sr-only">
        {running ? '' : announcement(game)}
      </p>
    </>
  )
}

/**
 * Stop or Continue the model, one control in one place: present for as long as the model holds the
 * board, so the row keeps its width as the model starts, stops and finishes.
 */
export function PlayToggle({
  game,
  sending,
  onContinue,
  onStop,
}: {
  game: Game
  sending: boolean
  onContinue: () => void
  onStop: () => void
}) {
  if (game.mode !== 'model') return null
  if (modelPlays(game) && game.waiting?.status === 'thinking')
    return (
      <IconButton aria-label="Stop" tooltip="Stop" size="lg" onClick={onStop} disabled={sending}>
        <Square />
      </IconButton>
    )
  return (
    <IconButton
      aria-label="Continue"
      tooltip="Continue"
      size="lg"
      onClick={onContinue}
      disabled={sending || !mayContinue(game)}
    >
      <Play />
    </IconButton>
  )
}

/**
 * A failed request, or a model that stopped without being asked to, with the way out. A stop the
 * person pressed is only "Paused" in the status: nothing went wrong.
 */
export function TurnProblem({
  game,
  error,
  sending,
  onRetry,
  onContinue,
  onPlayYourself,
}: {
  game: Game
  error: string | null
  sending: boolean
  onRetry: () => void
  onContinue: () => void
  onPlayYourself: () => void
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
  const waiting = game.waiting
  if (!modelPlays(game) || waiting?.status !== 'unreachable' || stopped(game)) return null
  return (
    <GameProblem
      title="The decision model stopped"
      description={waiting.reason}
      actions={
        <>
          <Button size="sm" variant="secondary" onClick={onContinue} disabled={sending}>
            <Play data-icon="inline-start" />
            Try again
          </Button>
          <Button size="sm" variant="ghost" onClick={onPlayYourself} disabled={sending}>
            Play it yourself
          </Button>
        </>
      }
    />
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
