import { RefreshCw } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { cn } from '@localixai/plugin-sdk/ui/classes'

import { viewOwesAgentMove, type PlayerView } from '../../shared/game'
import { announcement, elapsed, headline } from './copy'

/** After this long without the agent's move, the status offers to ask it again. */
export const PATIENCE_MS = 20_000

/**
 * The line between the score and the hands: what the round waits for, how long the agent has been
 * choosing, and the way out of a wait that stalled. The time is `now` against the moment the agent
 * was asked, so a hidden pane loses nothing.
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
  const agentTurn = viewOwesAgentMove(view)
  const waiting = view.waiting
  const thinkingFor = waiting ? now - Date.parse(waiting.since) : 0
  const thinking = agentTurn && (waiting === null || waiting.status === 'thinking')
  const stuck = agentTurn && (!thinking || thinkingFor >= PATIENCE_MS)
  const outcome = view.round.outcome

  return (
    // A fixed height, so the hands do not move when the recovery action appears.
    <div className="flex min-h-14 flex-col items-center justify-center gap-1.5 text-center">
      <p
        role={error ? 'alert' : undefined}
        className={cn(
          'flex items-baseline gap-2 text-lg font-semibold tracking-tight',
          error ? 'text-status-warning' : outcome === 'won' && 'text-status-success',
        )}
      >
        <span>{error ?? headline(view)}</span>
        {!error && thinking && waiting && (
          <span className="font-mono text-xs font-normal tabular-nums text-text-faint">
            {elapsed(thinkingFor)}
          </span>
        )}
      </p>
      {agentTurn && waiting?.status === 'unreachable' && waiting.reason && (
        <p className="text-xs text-status-warning">{waiting.reason}</p>
      )}
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
