import { useEffect } from 'react'
import { MessageSquareOff, RotateCcw, Shuffle, Ship } from 'lucide-react'
import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { useElementVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { IconButton } from '@localixai/kit/icon-button'
import { Button } from '@localixai/kit/button'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { StateNotice } from '@localixai/kit/state-notice'
import { OpponentMenu } from '@localixai/kit/opponent-menu'
import { GameControlRow } from '@localixai/kit/game-status'

import { owesAgentShot } from '../shared/game'
import { gameMessageContext } from './bindings'
import { Boards } from './game/Boards'
import { GameOver, TurnProblem, TurnStatus } from './game/TurnPanel'
import { useGame } from './game/useGame'
import { useNow } from './useNow'

/**
 * This chat's table: a status row, then the two boards side by side, filling the rest of the pane
 * (`Boards` measures it and sizes the tiles to fit). The row keeps one height whatever the state,
 * and what stopped the game floats over the boards ({@link TurnProblem}), so the boards never move.
 *
 * Before the first shot the person may place their fleet anew; after it the fleet is set. The
 * view only ever holds the person's side of the game — the agent's fleet is not in the browser —
 * and it publishes that side as message context WITHOUT the person's fleet (`bindings.ts`), since
 * the agent reads it.
 */
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
  const now = useNow(1000, active && visible && owesAgentShot(view))

  useEffect(() => {
    if (!active || !view) {
      publishMessageContext?.(null)
      return
    }
    publishMessageContext?.(gameMessageContext(view))
    return () => publishMessageContext?.(null)
  }, [active, view, publishMessageContext])

  return (
    <div ref={ref} className="flex h-full min-h-0 flex-col overflow-hidden px-6 py-4">
      <h1 className="sr-only">Battleship</h1>
      {!view ? (
        <div className="flex flex-1 items-center justify-center">
          {!state.hasTable ? (
            <StateNotice
              icon={MessageSquareOff}
              title="Open the board from a chat"
              body="Each chat has its own game, played with the agent in that chat."
            />
          ) : state.loading ? (
            <LoadingHint>Placing the fleets…</LoadingHint>
          ) : (
            <StateNotice
              icon={Ship}
              title="The board is unavailable"
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
      ) : (
        <Boards
          view={view}
          playable={view.status === 'playing' && view.turn === 'you' && !state.sending}
          onFire={(cell) => void state.fire(cell)}
          status={
            <GameControlRow
              status={<TurnStatus view={view} now={now} />}
              controls={
                <>
                  {view.shots.length === 0 && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={state.sending}
                      onClick={() => void state.reshuffle()}
                    >
                      <Shuffle data-icon="inline-start" />
                      New fleet
                    </Button>
                  )}
                  <OpponentMenu
                    heading="Who fires at your fleet"
                    value={view.opponent ?? 'agent'}
                    disabled={state.sending}
                    onChange={(opponent) => void state.setOpponent(opponent)}
                  />
                  <IconButton
                    aria-label="New game"
                    tooltip="New game"
                    size="lg"
                    disabled={state.sending || view.shots.length === 0}
                    onClick={() => void state.newGame()}
                  >
                    <RotateCcw />
                  </IconButton>
                </>
              }
            />
          }
          overlay={
            <>
              <TurnProblem
                view={view}
                now={now}
                error={state.error}
                sending={state.sending}
                onRetry={() => state.refresh()}
                onRemind={() => void state.remind()}
                onOpponent={(opponent) => void state.setOpponent(opponent)}
              />
              <GameOver
                view={view}
                sending={state.sending}
                onNewGame={() => void state.newGame()}
              />
            </>
          }
        />
      )}
    </div>
  )
}
