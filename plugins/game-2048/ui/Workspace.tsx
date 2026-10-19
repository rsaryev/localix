import { useEffect } from 'react'
import { Grid2x2, MessageSquareOff, RotateCcw } from 'lucide-react'
import type { PublishMessageContext } from '@localixai/plugin-sdk/ui'
import { SegmentedRadioGroup } from '@localixai/plugin-sdk/ui/segmented-control'
import { useElementVisible } from '@localixai/plugin-sdk/ui/visibility'
import { IconButton } from '@localixai/kit/icon-button'
import { Button } from '@localixai/kit/button'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { StateNotice } from '@localixai/kit/state-notice'
import { OpponentMenu } from '@localixai/kit/opponent-menu'

import { agentPlays, type Mode } from '../shared/game'
import { gameMessageContext } from './bindings'
import { Board } from './game/Board'
import { GameOver, TurnStatus } from './game/TurnPanel'
import { useGame } from './game/useGame'
import { useNow } from './useNow'

/**
 * This chat's board: a compact control row, the board, and the result over it — the same frame as
 * Tic-Tac-Toe, Chess, Checkers and Battleship.
 *
 * The board follows the pane's width and stops at 36rem, where a tile is still a comfortable
 * target and the board still reads as one object; a short pane scrolls rather than shrinking it.
 * (Sizing by the pane's HEIGHT needs a size container, and a size container whose host gives it
 * no definite height collapses to nothing.) The status shares a row with the controls — who
 * plays, and a new game — so the board stays close to what is needed to play it. Who plays is two
 * steps, never two competing switches: **I play** or **Watch**, and while watching, the menu beside
 * it says WHICH player holds the board — the chat agent or the decision model.
 *
 * It publishes EXACTLY the game on screen as message context, and clears it the moment the
 * surface goes inactive, so a question typed beside the board is about this position.
 */
const BOARD_SIZE = 'min(100%, 36rem)'

const WHO_PLAYS = [
  { value: 'user', label: 'I play' },
  { value: 'agent', label: 'Watch' },
] as const

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
  const now = useNow(1000, active && visible && agentPlays(game))

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
      <h1 className="sr-only">2048</h1>
      <div className="flex min-h-full flex-col items-center justify-center gap-3 p-6">
        {!game ? (
          <div
            className="flex aspect-square items-center justify-center"
            style={{ width: BOARD_SIZE }}
          >
            {!state.hasTable ? (
              <StateNotice
                icon={MessageSquareOff}
                title="Open 2048 from a chat"
                body="Each chat has its own board, played by you or by the agent in that chat."
              />
            ) : state.loading ? (
              <LoadingHint>Setting up the board…</LoadingHint>
            ) : (
              <StateNotice
                icon={Grid2x2}
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
            <div
              className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2"
              style={{ maxWidth: BOARD_SIZE }}
            >
              <TurnStatus
                game={game}
                now={now}
                error={state.error}
                sending={state.sending}
                onRemind={() => void state.remind()}
                onStop={() => void state.stop()}
              />
              <div className="flex items-center gap-2">
                <SegmentedRadioGroup<Mode>
                  aria-label="Who plays"
                  size="sm"
                  value={game.mode}
                  options={WHO_PLAYS}
                  disabled={state.sending}
                  onValueChange={(mode) => void state.setMode(mode)}
                />
                {game.mode === 'agent' && (
                  <OpponentMenu
                    heading="Who plays the board"
                    size="sm"
                    value={game.opponent ?? 'agent'}
                    disabled={state.sending}
                    onChange={(opponent) => void state.setOpponent(opponent)}
                  />
                )}
                <IconButton
                  aria-label="New game"
                  tooltip="New game"
                  size="lg"
                  disabled={state.sending || game.moves === 0}
                  onClick={() => void state.newGame(game.mode)}
                >
                  <RotateCcw />
                </IconButton>
              </div>
            </div>
            <div className="relative" style={{ width: BOARD_SIZE }}>
              <Board
                game={game}
                playable={
                  active &&
                  visible &&
                  game.mode === 'user' &&
                  game.status === 'playing' &&
                  !state.sending
                }
                onMove={(direction) => void state.play(direction)}
              />
              <GameOver
                game={game}
                sending={state.sending}
                onNewGame={() => void state.newGame(game.mode)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
