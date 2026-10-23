import { lazy } from 'react'
import { Grid3x3 } from 'lucide-react'
import { sessionGameUi } from '@localixai/mini-app-sdk/ui/session-game'
import { LoadingHint } from '@localixai/kit/empty-hint'

import { GAME_KIND, sessionOfGameUri } from '../shared/resource'

const Workspace = lazy(() =>
  import('./Workspace').then((module) => ({ default: module.Workspace })),
)

/** One board per chat, its launcher and the anchor its tool opens (`sessionGameUi`). */
export const registerUi = sessionGameUi({
  miniApp: 'tic-tac-toe',
  kind: GAME_KIND,
  title: 'Tic-Tac-Toe',
  label: 'Tic-Tac-Toe — play against the agent',
  keywords: ['game', 'tic-tac-toe', 'noughts', 'crosses', 'play', 'x', 'o'],
  Icon: Grid3x3,
  Workspace,
  loading: <LoadingHint>Opening Tic-Tac-Toe…</LoadingHint>,
  agentContext: {
    description:
      'This chat’s Tic-Tac-Toe board. The user plays X; you play O. When you owe a move, the board wakes this chat with the position.',
    tools: ['tic_tac_toe'],
    nextSteps: [
      'On your turn, play with tic_tac_toe action "move" — the user sees the board.',
      'Read the position with tic_tac_toe action "state" before you comment on it.',
      'When the user asks to play or to start over, call tic_tac_toe action "new_game".',
    ],
  },
  sessionOf: sessionOfGameUri,
})
