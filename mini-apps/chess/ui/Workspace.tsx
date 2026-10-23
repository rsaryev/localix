import { useEffect } from 'react'
import { ChessKnight, MessageSquareOff, RotateCcw } from 'lucide-react'
import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { useElementVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { OpponentMenu } from '@localixai/kit/opponent-menu'
import { GameControlRow } from '@localixai/kit/game-status'
import { IconButton } from '@localixai/kit/icon-button'
import { Button } from '@localixai/kit/button'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { StateNotice } from '@localixai/kit/state-notice'

import { gameMessageContext } from './bindings'
import { Board } from './game/Board'
import { GameOver, TurnProblem, TurnStatus } from './game/TurnPanel'
import { owesAgentMove, turnOf } from '../shared/game'
import { other } from '../shared/position'
import { useGame } from './game/useGame'
import { useNow } from './useNow'

/**
 * This chat's table: a compact control row, the board, and the result over it.
 *
 * The board follows the pane's width and stops at 36rem, where a square is still a comfortable
 * target and the board still reads as one object; a short pane scrolls rather than shrinking it.
 * (Sizing by the pane's HEIGHT needs a size container, and a size container whose host gives it
 * no definite height collapses to nothing.) The status shares a row with the new-game control, so
 * the board stays close to the information needed to play it. The row keeps one height whatever
 * the state, and what stopped the game floats over the board ({@link TurnProblem}), so the board
 * never moves.
 *
 * It publishes EXACTLY the game on screen as message context, and clears it the moment the
 * surface goes inactive, so a question typed beside the board is about this position.
 */
const BOARD_SIZE = 'min(100%, 36rem)'

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
      <h1 className="sr-only">Chess</h1>
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
                icon={ChessKnight}
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
                    heading={`Who plays ${other(game.you)}`}
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
                playable={game.status === 'playing' && turnOf(game) === game.you && !state.sending}
                onPlay={(move) => void state.play(move)}
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
