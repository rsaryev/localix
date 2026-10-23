import { lazy } from 'react'
import { Ship } from 'lucide-react'
import { sessionGameUi } from '@localixai/mini-app-sdk/ui/session-game'
import { LoadingHint } from '@localixai/kit/empty-hint'

import { GAME_KIND, sessionOfGameUri } from '../shared/resource'

const Workspace = lazy(() =>
  import('./Workspace').then((module) => ({ default: module.Workspace })),
)

/** One board per chat, its launcher and the anchor its tool opens (`sessionGameUi`). */
export const registerUi = sessionGameUi({
  miniApp: 'battleship',
  kind: GAME_KIND,
  title: 'Battleship',
  label: 'Battleship — play against the agent',
  keywords: ['game', 'battleship', 'sea battle', 'ships', 'play'],
  Icon: Ship,
  Workspace,
  loading: <LoadingHint>Opening Battleship…</LoadingHint>,
  agentContext: {
    description:
      'This chat’s Battleship game. You and the user each have a hidden fleet and fire in turn; a hit earns another shot. When you owe a shot, the board wakes this chat with what you may see.',
    tools: ['battleship'],
    nextSteps: [
      'On your turn, fire with battleship action "fire" — after a hit, fire again.',
      'Read your side of the game with battleship action "state" before you comment on it.',
      'When the user asks to play or to start over, call battleship action "new_game".',
    ],
  },
  sessionOf: sessionOfGameUri,
})
