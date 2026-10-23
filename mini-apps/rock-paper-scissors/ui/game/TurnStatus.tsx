import { RefreshCw } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { GameProblem, GameStatus } from '@localixai/kit/game-status'
import { OTHER_OPPONENT } from '@localixai/mini-app-sdk/opponent'

import { viewOwesAgentMove, type Opponent, type PlayerView } from '../../shared/game'
import { announcement, elapsed, headline, opponentName } from './copy'

/** After this long without the agent's move, the table offers to ask it again. */
export const PATIENCE_MS = 20_000

/**
 * The table's state on the same surfaces as the other games, none of which moves the hands:
 *
 * - {@link TurnStatus} — the two lines in the control row: what the round waits for, how long the
 *   agent has been choosing, and the round with its draws (the score is the numerals below).
 * - {@link TurnProblem} — what stopped the round, over the hands: a failed request, an opponent
 *   that did not answer, a choice that is taking too long, each with its way out.
 *
 * The time is `now` against the moment the agent was asked, so a hidden pane loses nothing.
 */
export function TurnStatus({ view, now }: { view: PlayerView; now: number }) {
  const waiting = view.waiting
  const thinking = viewOwesAgentMove(view) && (waiting === null || waiting.status === 'thinking')
  const draws = view.record.draw === 1 ? '1 draw' : `${view.record.draw} draws`
  return (
    <>
      <GameStatus
        title={headline(view)}
        tone={view.round.outcome === 'won' ? 'success' : 'default'}
        suffix={thinking && waiting ? `· ${elapsed(now - Date.parse(waiting.since))}` : undefined}
        detail={`Round ${view.round.number}${view.record.draw > 0 ? ` · ${draws}` : ''}`}
      />
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
  if (!viewOwesAgentMove(view)) return null
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
        title={`${opponentName(view)} did not choose`}
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
