import { lazy } from 'react'
import { ChessKnight } from 'lucide-react'
import { sessionGameUi } from '@localixai/mini-app-sdk/ui/session-game'
import { LoadingHint } from '@localixai/kit/empty-hint'

import { GAME_KIND, sessionOfGameUri } from '../shared/resource'

const Workspace = lazy(() =>
  import('./Workspace').then((module) => ({ default: module.Workspace })),
)

/** One board per chat, its launcher and the anchor its tool opens (`sessionGameUi`). */
export const registerUi = sessionGameUi({
  miniApp: 'chess',
  kind: GAME_KIND,
  title: 'Chess',
  label: 'Chess — play against the agent',
  keywords: ['game', 'chess', 'play'],
  Icon: ChessKnight,
  Workspace,
  loading: <LoadingHint>Opening Chess…</LoadingHint>,
  agentContext: {
    description:
      'This chat’s chess board. The user plays one colour and you the other. When you owe a move, the board wakes this chat with the position and the legal moves.',
    tools: ['chess'],
    nextSteps: [
      'On your turn, play one of the legal moves with chess action "move" — the user sees the board.',
      'Read the position with chess action "state" before you comment on it.',
      'When the user asks to play or to start over, call chess action "new_game".',
    ],
  },
  sessionOf: sessionOfGameUri,
})
