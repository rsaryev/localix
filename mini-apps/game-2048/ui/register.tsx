import { lazy } from 'react'
import { Grid2x2 } from 'lucide-react'
import { sessionGameUi } from '@localixai/mini-app-sdk/ui/session-game'
import { LoadingHint } from '@localixai/kit/empty-hint'

import { GAME_KIND, sessionOfGameUri } from '../shared/resource'

const Workspace = lazy(() =>
  import('./Workspace').then((module) => ({ default: module.Workspace })),
)

/** One board per chat, its launcher and the anchor its tool opens (`sessionGameUi`). */
export const registerUi = sessionGameUi({
  miniApp: 'game-2048',
  kind: GAME_KIND,
  title: '2048',
  label: '2048 — play or watch the agent',
  keywords: ['2048', 'game', 'puzzle'],
  Icon: Grid2x2,
  Workspace,
  loading: <LoadingHint>Opening 2048…</LoadingHint>,
  agentContext: {
    description:
      'This chat’s 2048 board. The user chooses who controls it. Use game_2048 to move only when the agent controls it.',
    tools: ['game_2048'],
    nextSteps: [
      'Read the board with game_2048 action "state".',
      'When the agent controls the board, play it with action "move" and a "prefer" order of directions until the game ends.',
    ],
  },
  sessionOf: sessionOfGameUri,
})
