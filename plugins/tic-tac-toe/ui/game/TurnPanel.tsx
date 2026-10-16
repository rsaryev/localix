import { CircleAlert, Equal, Flag, RefreshCw, RotateCcw, Trophy } from 'lucide-react'
import { ActivityOrb } from '@localixai/kit/activity-orb'
import { Button } from '@localixai/kit/button'
import { cn } from '@localixai/plugin-sdk/ui/classes'

import { lineName } from '../../shared/describe'
import { owesAgentMove, type Game } from '../../shared/game'
import { announcement, elapsed, headline, nextOpener, scoreLine } from './copy'
import { Mark } from './Mark'

/** After this long without the agent's move, the status offers to ask it again. */
export const PATIENCE_MS = 20_000

/**
 * Two surfaces for the game's state, so nothing sits under the board:
 *
 * - {@link TurnStatus} — the status beside the new-game control: whose turn, each player's mark,
 *   the score at this table, how long the agent has been thinking, and the way out of a wait that
 *   stalled.
 * - {@link GameOver} — the card that rises over the board when a game ends, with the result and
 *   the next game. The board stays visible behind it, so the winning line is part of the result.
 *
 * Nothing here counts: the time the agent has been thinking is `now` against the moment it was
 * asked, so a hidden pane loses nothing.
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
  const agentTurn = owesAgentMove(game)
  const waiting = game.waiting
  const thinkingFor = waiting ? now - Date.parse(waiting.since) : 0
  const thinking = agentTurn && (waiting === null || waiting.status === 'thinking')
  const stuck = agentTurn && (!thinking || thinkingFor >= PATIENCE_MS)
  const suffix = thinking && waiting ? ` · ${elapsed(thinkingFor)}` : ''

  return (
    // Reserve space for recovery actions before they appear, so the board does not move on a stall.
    <div className="flex min-h-20 min-w-40 flex-1 flex-col items-start justify-center gap-1">
      <p
        role={error ? 'alert' : undefined}
        className={cn(
          'flex items-center gap-2 text-base font-medium',
          error ? 'text-status-warning' : 'text-text-soft',
        )}
      >
        {!error && game.status === 'playing' && <StateIcon game={game} thinking={thinking} />}
        <span className={cn(!error && 'text-foreground')}>{error ?? headline(game)}</span>
        {!error && suffix && (
          <span className="font-mono tabular-nums text-text-faint">{suffix}</span>
        )}
      </p>
      <p className="text-xs text-text-faint">You play X · Agent plays O{scoreLine(game.record)}</p>
      {/* Heard, not seen: the move just played and what it means, once per change. */}
      <p aria-live="polite" className="sr-only">
        {announcement(game)}
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

const RESULT = {
  won: { Icon: Trophy, tone: 'text-status-success', title: 'You won' },
  lost: { Icon: Flag, tone: 'text-text-soft', title: '' },
  draw: { Icon: Equal, tone: 'text-text-soft', title: 'Draw' },
} as const

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
  const { Icon, tone } = RESULT[game.status]
  const title = game.status === 'lost' ? headline(game) : RESULT[game.status].title
  const how = game.line ? `Three in ${lineName(game.line)}.` : 'The board is full.'
  return (
    <div className="tic-tac-toe-over pointer-events-none absolute inset-0 z-(--z-raised) flex items-center justify-center">
      <div
        role="dialog"
        aria-label={title}
        className="pointer-events-auto flex w-[min(90%,20rem)] flex-col items-center gap-3 rounded-xl border border-border-soft bg-popover/90 px-6 py-5 text-center shadow-(--shadow-popover) backdrop-blur-md"
      >
        <Icon className={cn('size-7', tone)} aria-hidden />
        <div className="space-y-1">
          <h2 className={cn('text-lg font-semibold tracking-tight', game.status === 'won' && tone)}>
            {title}
          </h2>
          <p className="text-xs text-text-soft">
            {how} Next: {nextOpener(game)}.
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

function StateIcon({ game, thinking }: { game: Game; thinking: boolean }) {
  const icon = 'size-4 shrink-0'
  if (game.turn === 'X') return <Mark mark="X" className="size-3.5" />
  if (thinking) return <ActivityOrb className="size-4" />
  if (game.waiting?.status === 'unreachable')
    return <CircleAlert className={cn(icon, 'text-status-warning')} aria-hidden />
  return <Mark mark="O" className="size-3.5" />
}
