import { useEffect } from 'react'
import { ArrowRight, Hand as HandIcon, MessageSquareOff } from 'lucide-react'
import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { useElementVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { Button } from '@localixai/kit/button'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { StateNotice } from '@localixai/kit/state-notice'
import { OpponentMenu } from '@localixai/kit/opponent-menu'
import { GameControlRow } from '@localixai/kit/game-status'

import { theirMove, viewerMayMove, viewOwesAgentMove, type Outcome } from '../shared/game'
import { gameMessageContext } from './bindings'
import { nextOpener, opponentName, opponentTitle, verdictLine } from './game/copy'
import { Hand } from './game/Hand'
import { MovePicker } from './game/MovePicker'
import { Scoreboard } from './game/Scoreboard'
import { TurnProblem, TurnStatus } from './game/TurnStatus'
import { useGame } from './game/useGame'
import { useVerified } from './game/useVerified'
import { useNow } from './useNow'
import './game/table.css'

/**
 * This chat's table, top to bottom: the control row every game shares (what the round waits for,
 * and who plays the other side), the score, the two hands facing each other, and the person's three
 * choices — or, once revealed, why the round went as it did. Nothing in the column changes height
 * with the state: what stopped the round floats over the hands ({@link TurnProblem}).
 *
 * The agent's hand shows only what the person may see — nothing, a sealed card with its digest,
 * or the revealed move with the browser's own digest check. The view publishes exactly the round
 * on screen as message context, and clears it when the surface goes inactive.
 */
const TABLE_WIDTH = 'min(100%, 34rem)'

const SIDE_RESULT: Record<
  Outcome,
  { you: 'winner' | 'loser' | 'draw'; agent: 'winner' | 'loser' | 'draw' }
> = {
  won: { you: 'winner', agent: 'loser' },
  lost: { you: 'loser', agent: 'winner' },
  draw: { you: 'draw', agent: 'draw' },
}

export function Workspace({
  active = true,
  publishMessageContext,
}: {
  active?: boolean
  publishMessageContext?: PublishMessageContext
}) {
  const [ref, visible] = useElementVisible<HTMLDivElement>()
  const state = useGame(active && visible)
  const view = state.snapshot
  const agentTurn = viewOwesAgentMove(view)
  const now = useNow(1000, active && visible && agentTurn)
  const verified = useVerified(view?.round.theirs ?? null)

  useEffect(() => {
    if (!active || !view) {
      publishMessageContext?.(null)
      return
    }
    publishMessageContext?.(gameMessageContext(view))
    return () => publishMessageContext?.(null)
  }, [active, view, publishMessageContext])

  if (!view)
    return (
      <div ref={ref} className="flex h-full min-h-0 items-center justify-center p-6">
        {!state.hasTable ? (
          <StateNotice
            icon={MessageSquareOff}
            title="Open the table from a chat"
            body="Each chat has its own table, played with the agent in that chat."
          />
        ) : state.loading ? (
          <LoadingHint>Setting up the table…</LoadingHint>
        ) : (
          <StateNotice
            icon={HandIcon}
            title="The table is unavailable"
            body={state.error ?? 'Try again in a moment.'}
            actions={
              <Button size="sm" variant="secondary" onClick={() => state.refresh()}>
                Try again
              </Button>
            }
            role="alert"
          />
        )}
      </div>
    )

  const round = view.round
  const sides = round.outcome ? SIDE_RESULT[round.outcome] : null
  return (
    <div ref={ref} className="h-full min-h-0 overflow-x-hidden overflow-y-auto">
      <h1 className="sr-only">Rock Paper Scissors</h1>
      <div
        className="mx-auto flex min-h-full flex-col items-center justify-center gap-6 px-4 py-8"
        style={{ maxWidth: TABLE_WIDTH }}
      >
        <GameControlRow
          status={<TurnStatus view={view} now={now} />}
          controls={
            <OpponentMenu
              heading="Who plays against you"
              value={view.opponent ?? 'agent'}
              disabled={state.sending}
              onChange={(opponent) => void state.setOpponent(opponent)}
            />
          }
        />
        <Scoreboard record={view.record} opponent={opponentTitle(view)} />
        <div className="relative w-full">
          <div className="flex w-full items-start gap-2">
            <Hand
              title="You"
              side="left"
              move={round.mine}
              sealedFromOpponent={round.mine !== null && round.outcome === null}
              hiddenFrom={opponentName(view).toLowerCase()}
              {...(sides ? { result: sides.you } : {})}
            />
            <span
              className="mt-[3.6rem] shrink-0 font-mono text-2xs tracking-widest text-text-faint"
              aria-hidden
            >
              VS
            </span>
            <Hand
              title={opponentTitle(view)}
              side="right"
              move={theirMove(round)}
              {...(round.theirs ? { digest: round.theirs.digest } : {})}
              thinking={agentTurn && view.waiting?.status !== 'unreachable'}
              unreachable={agentTurn && view.waiting?.status === 'unreachable'}
              verified={verified}
              {...(sides ? { result: sides.agent } : {})}
            />
          </div>
          <TurnProblem
            view={view}
            now={now}
            error={state.error}
            sending={state.sending}
            onRetry={() => state.refresh()}
            onRemind={() => void state.remind()}
            onOpponent={(opponent) => void state.setOpponent(opponent)}
          />
        </div>
        <div className="flex min-h-28 w-full flex-col items-center justify-center gap-3">
          {round.outcome === null ? (
            <MovePicker
              enabled={viewerMayMove(view) && !state.sending}
              chosen={round.mine}
              onPick={(move) => void state.play(move)}
            />
          ) : (
            <>
              <p className="text-sm text-text-soft">{verdictLine(round)}</p>
              <Button
                variant="mono"
                size="lg"
                onClick={() => void state.nextRound()}
                disabled={state.sending}
              >
                Next round
                <ArrowRight data-icon="inline-end" />
              </Button>
              <p className="text-2xs text-text-faint">{capitalize(nextOpener(view))} next.</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
