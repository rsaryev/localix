import { lazy } from 'react'
import { CircleDot } from 'lucide-react'
import { sessionGameUi } from '@localixai/mini-app-sdk/ui/session-game'
import { LoadingHint } from '@localixai/kit/empty-hint'

import { GAME_KIND, sessionOfGameUri } from '../shared/resource'

const Workspace = lazy(() =>
  import('./Workspace').then((module) => ({ default: module.Workspace })),
)

/** One board per chat, its launcher and the anchor its tool opens (`sessionGameUi`). */
export const registerUi = sessionGameUi({
  miniApp: 'checkers',
  kind: GAME_KIND,
  title: 'Checkers',
  label: 'Checkers — play against the agent',
  keywords: ['game', 'checkers', 'draughts', 'play'],
  Icon: CircleDot,
  Workspace,
  loading: <LoadingHint>Opening Checkers…</LoadingHint>,
  agentContext: {
    description:
      'This chat’s Checkers (Russian draughts) board. The user plays one colour and you the other. When you owe a move, the board wakes this chat with the position and the legal moves.',
    tools: ['checkers'],
    nextSteps: [
      'On your turn, play one of the legal moves with checkers action "move" — the user sees the board.',
      'Read the position with checkers action "state" before you comment on it.',
      'When the user asks to play or to start over, call checkers action "new_game".',
    ],
  },
  sessionOf: sessionOfGameUri,
})
