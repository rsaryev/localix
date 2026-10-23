import {
  CircleAlert,
  CircleX,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  Trophy,
  User,
} from 'lucide-react'
import { ActivityOrb } from '@localixai/kit/activity-orb'
import { Button } from '@localixai/kit/button'
import { GameProblem, GameStatus } from '@localixai/kit/game-status'
import { IconButton } from '@localixai/kit/icon-button'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { OTHER_OPPONENT } from '@localixai/mini-app-sdk/opponent'

import { agentPlays, stopped, type Game, type Opponent } from '../../shared/game'
import {
  announcement,
  elapsed,
  headline,
  mayRemind,
  playerName,
  resultLine,
  shortScoreLine,
  spokenHeadline,
} from './copy'

/**
 * After this long without an agent move, the board offers to ask it again. Longer than the other
 * games' 20s: the agent plays many calls in one turn, and one slow model call is not a stall.
 */
export const PATIENCE_MS = 45_000

/**
 * The game's state on the same surfaces as the other games, none of them under the board and none
 * that moves it:
 *
 * - {@link TurnStatus} — two lines beside the controls: who is playing, how long since the chat
 *   agent's last move, and the score.
 * - {@link PlayToggle} — Stop or Continue in the control row, while the agent holds the board.
 * - {@link TurnProblem} — over the top of the board: a failed request, or a player that stopped
 *   without being asked to, with the way out.
 * - {@link GameOver} — the card that rises over the board when a game ends. The board stays
 *   visible behind it, so the final position is part of the result.
 *
 * Nothing here counts: the time since the agent's last move is `now` against the moment it moved.
 */
export function TurnStatus({ game, now }: { game: Game; now: number }) {
  // The chat agent may take a while per call; the decision model moves every second or so, so a
  // running clock beside it would only flicker.
  const playing =
    agentPlays(game) && game.opponent !== 'decision' && game.waiting?.status === 'thinking'
  return (
    <>
      <GameStatus
        icon={game.status === 'playing' && <StateIcon game={game} />}
        title={headline(game)}
        suffix={playing ? `· ${elapsed(now - Date.parse(game.waiting!.since))}` : undefined}
        detail={shortScoreLine(game)}
      />
      {/* Heard, not seen: the move just made and what it means, once per change. */}
      <p aria-live="polite" className="sr-only">
        {announcement(game)}
      </p>
    </>
  )
}

/**
 * Stop or Continue the player, one control in one place: present for as long as the agent holds
 * the board, so the row keeps its width as it starts, stops and finishes. Continue also asks again
 * once a move is overdue.
 */
export function PlayToggle({
  game,
  now,
  sending,
  onContinue,
  onStop,
}: {
  game: Game
  now: number
  sending: boolean
  onContinue: () => void
  onStop: () => void
}) {
  if (game.mode !== 'agent') return null
  const remind = mayRemind(game, now, PATIENCE_MS)
  if (agentPlays(game) && game.waiting?.status === 'thinking' && !remind)
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
      disabled={sending || !remind}
    >
      <Play />
    </IconButton>
  )
}

/**
 * A failed request, or a player that stopped without being asked to, with the way out. A stop the
 * person pressed is only "Paused" in the status: nothing went wrong.
 */
export function TurnProblem({
  game,
  error,
  sending,
  onRetry,
  onContinue,
  onOpponent,
}: {
  game: Game
  error: string | null
  sending: boolean
  onRetry: () => void
  onContinue: () => void
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
  const waiting = game.waiting
  if (!agentPlays(game) || waiting?.status !== 'unreachable' || stopped(game)) return null
  const other = OTHER_OPPONENT[game.opponent ?? 'agent']
  return (
    <GameProblem
      title={`${playerName(game)} stopped`}
      description={waiting.reason}
      actions={
        <>
          <Button size="sm" variant="secondary" onClick={onContinue} disabled={sending}>
            <Play data-icon="inline-start" />
            Try again
          </Button>
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
  const title = spokenHeadline(game)
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
