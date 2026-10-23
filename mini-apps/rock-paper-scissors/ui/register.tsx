import { lazy } from 'react'
import { Hand } from 'lucide-react'
import { sessionGameUi } from '@localixai/mini-app-sdk/ui/session-game'
import { LoadingHint } from '@localixai/kit/empty-hint'

import { GAME_KIND, sessionOfGameUri } from '../shared/resource'

const Workspace = lazy(() =>
  import('./Workspace').then((module) => ({ default: module.Workspace })),
)

/** One board per chat, its launcher and the anchor its tool opens (`sessionGameUi`). */
export const registerUi = sessionGameUi({
  miniApp: 'rock-paper-scissors',
  kind: GAME_KIND,
  title: 'Rock Paper Scissors',
  label: 'Rock Paper Scissors — sealed moves against the agent',
  keywords: ['game', 'rock', 'paper', 'scissors', 'roshambo', 'play'],
  Icon: Hand,
  Workspace,
  loading: <LoadingHint>Opening Rock Paper Scissors…</LoadingHint>,
  agentContext: {
    description:
      'This chat’s Rock Paper Scissors table. Each round is two sealed moves; when you owe one, the table wakes this chat.',
    tools: ['rock_paper_scissors'],
    nextSteps: [
      'On your turn, play with rock_paper_scissors action "play" — the move is sealed; never name it in text.',
      'Read the table with rock_paper_scissors action "state" before you comment on it.',
      'When the user asks to play, call rock_paper_scissors action "next_round".',
    ],
  },
  sessionOf: sessionOfGameUri,
})
