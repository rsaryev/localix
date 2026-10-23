import { useEffect } from 'react'
import { Grid3x3, MessageSquareOff, RotateCcw } from 'lucide-react'
import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { useElementVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { IconButton } from '@localixai/kit/icon-button'
import { Button } from '@localixai/kit/button'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { StateNotice } from '@localixai/kit/state-notice'
import { OpponentMenu } from '@localixai/kit/opponent-menu'
import { GameControlRow } from '@localixai/kit/game-status'

import { owesAgentMove } from '../shared/game'
import { gameMessageContext } from './bindings'
import { Board } from './game/Board'
import { GameOver, TurnProblem, TurnStatus } from './game/TurnPanel'
import { useGame } from './game/useGame'
import { useNow } from './useNow'

/**
 * This chat's table: a compact control row, the board, and the result over it.
 *
 * The control row holds who plays O ({@link OpponentMenu}) beside the new game.
 *
 * The board follows the pane's width and stops at 34rem, where a 3×3 grid still reads as one object
 * rather than as nine far-apart tiles; a short pane scrolls rather than shrinking it. (Sizing by the
 * pane's HEIGHT needs a size container, and a size container whose host gives it no definite
 * height collapses to nothing.) The status shares a row with the new-game control, so the board
 * stays close to the information needed to play it. The row keeps one height whatever the state,
 * and what stopped the game floats over the board ({@link TurnProblem}), so the board never moves.
 *
 * It publishes EXACTLY the game on screen as message context, and clears it the moment the
 * surface goes inactive, so a question typed beside the board is about this position.
 */
const BOARD_SIZE = 'min(100%, 34rem)'

export function Workspace({
  active = true,
  publishMessageContext,
}: {
  active?: boolean
  publishMessageContext?: PublishMessageContext
}) {
  const [ref, visible] = useElementVisible<HTMLDivElement>()
  const state = useGame(active && visible)
  const game = state.snapshot
  const now = useNow(1000, active && visible && owesAgentMove(game))

  useEffect(() => {
    if (!active || !game) {
      publishMessageContext?.(null)
      return
    }
    publishMessageContext?.(gameMessageContext(game))
    return () => publishMessageContext?.(null)
  }, [active, game, publishMessageContext])

  return (
    <div ref={ref} className="h-full min-h-0 overflow-x-hidden overflow-y-auto">
      <h1 className="sr-only">Tic-Tac-Toe</h1>
      <div className="flex min-h-full flex-col items-center justify-center gap-3 p-6">
        {!game ? (
          <div
            className="flex aspect-square items-center justify-center"
            style={{ width: BOARD_SIZE }}
          >
            {!state.hasTable ? (
              <StateNotice
                icon={MessageSquareOff}
                title="Open the board from a chat"
                body="Each chat has its own board, played with the agent in that chat."
              />
            ) : state.loading ? (
              <LoadingHint>Setting up the board…</LoadingHint>
            ) : (
              <StateNotice
                icon={Grid3x3}
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
          <>
            <GameControlRow
              style={{ maxWidth: BOARD_SIZE }}
              status={<TurnStatus game={game} now={now} />}
              controls={
                <>
                  <OpponentMenu
                    heading="Who plays O"
                    value={game.opponent ?? 'agent'}
                    disabled={state.sending}
                    onChange={(opponent) => void state.setOpponent(opponent)}
                  />
                  <IconButton
                    aria-label="New game"
                    tooltip="New game"
                    size="lg"
                    disabled={state.sending || game.moves.length === 0}
                    onClick={() => void state.newGame()}
                  >
                    <RotateCcw />
                  </IconButton>
                </>
              }
            />
            <div className="relative" style={{ width: BOARD_SIZE }}>
              <Board
                game={game}
                playable={game.status === 'playing' && game.turn === 'X' && !state.sending}
                onPlay={(cell) => void state.play(cell)}
              />
              <TurnProblem
                game={game}
                now={now}
                error={state.error}
                sending={state.sending}
                onRetry={() => state.refresh()}
                onRemind={() => void state.remind()}
                onOpponent={(opponent) => void state.setOpponent(opponent)}
              />
              <GameOver
                game={game}
                sending={state.sending}
                onNewGame={() => void state.newGame()}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
