import { useEffect } from 'react'
import { Grid3x3, MessageSquareOff, RotateCcw } from 'lucide-react'
import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { SegmentedRadioGroup } from '@localixai/mini-app-sdk/ui/segmented-control'
import { useElementVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { IconButton } from '@localixai/kit/icon-button'
import { Button } from '@localixai/kit/button'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { StateNotice } from '@localixai/kit/state-notice'
import { GameControlRow } from '@localixai/kit/game-status'

import { TICK_MS, type Mode } from '../shared/game'
import { gameMessageContext } from './bindings'
import { Board } from './game/Board'
import { GameOver, PlayToggle, TurnProblem, TurnStatus } from './game/TurnPanel'
import { useGame } from './game/useGame'
import { useHumanRun } from './game/useHumanRun'
import { useStepPace } from './game/useStepPace'

/**
 * This chat's board: a compact control row, the board, and the result over it — the same frame as
 * 2048 and the other games.
 *
 * Who steers is one switch: **I play**, or **Model plays** — the host's decision model, asked by
 * the board one move at a time. There is no chat-agent player. The person's game runs in the view
 * (`useHumanRun`); the model's runs in the backend and arrives through the store feed.
 *
 * It publishes the STORED game as message context — not every tick of a running snake — and clears
 * it the moment the surface goes inactive.
 */
const BOARD_SIZE = 'min(100%, 34rem)'

const WHO_PLAYS = [
  { value: 'user', label: 'I play' },
  { value: 'model', label: 'Model plays' },
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
  const stored = state.snapshot
  const human = useHumanRun({
    stored,
    enabled:
      active && visible && stored?.mode === 'user' && stored.status === 'playing' && !state.error,
    saveTurns: state.saveTurns,
  })
  const game = human.game
  // A save of the person's own run is not a request they wait on.
  const busy = state.sending && !human.running
  // The person's snake glides over a whole tick; the model's over the pace its steps arrive at.
  const modelPace = useStepPace(
    game?.tick ?? 0,
    game?.mode === 'model' && game.status === 'playing',
  )

  useEffect(() => {
    if (!active || !stored) {
      publishMessageContext?.(null)
      return
    }
    publishMessageContext?.(gameMessageContext(stored))
    return () => publishMessageContext?.(null)
  }, [active, stored, publishMessageContext])

  return (
    <div ref={ref} className="h-full min-h-0 overflow-x-hidden overflow-y-auto">
      <h1 className="sr-only">Snake</h1>
      <div className="flex min-h-full flex-col items-center justify-center gap-3 p-6">
        {!game ? (
          <div
            className="flex aspect-square items-center justify-center"
            style={{ width: BOARD_SIZE }}
          >
            {!state.hasTable ? (
              <StateNotice
                icon={MessageSquareOff}
                title="Open Snake from a chat"
                body="Each chat has its own board, played by you or by a decision model."
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
              status={<TurnStatus game={game} running={human.running} />}
              controls={
                <>
                  <SegmentedRadioGroup<Mode>
                    aria-label="Who plays"
                    size="sm"
                    value={game.mode}
                    options={WHO_PLAYS}
                    disabled={busy}
                    onValueChange={(mode) => void state.setMode(mode)}
                  />
                  <PlayToggle
                    game={game}
                    sending={busy}
                    onContinue={() => void state.remind()}
                    onStop={() => void state.stop()}
                  />
                  <IconButton
                    aria-label="New game"
                    tooltip="New game"
                    size="lg"
                    disabled={busy || game.tick === 0}
                    onClick={() => void state.newGame(game.mode)}
                  >
                    <RotateCcw />
                  </IconButton>
                </>
              }
            />
            <div className="relative" style={{ width: BOARD_SIZE }}>
              <Board
                game={game}
                playable={active && visible && game.mode === 'user' && game.status === 'playing'}
                glideMs={human.running ? TICK_MS : modelPace}
                onSteer={human.steer}
              />
              <TurnProblem
                game={game}
                error={state.error}
                sending={busy}
                onRetry={() => state.refresh()}
                onContinue={() => void state.remind()}
                onPlayYourself={() => void state.setMode('user')}
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
