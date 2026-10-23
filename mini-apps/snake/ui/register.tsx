import { lazy } from 'react'
import { Worm } from 'lucide-react'
import { sessionGameUi } from '@localixai/mini-app-sdk/ui/session-game'
import { LoadingHint } from '@localixai/kit/empty-hint'

import { GAME_KIND, sessionOfGameUri } from '../shared/resource'

const Workspace = lazy(() =>
  import('./Workspace').then((module) => ({ default: module.Workspace })),
)

/** One board per chat, its launcher and the anchor its tool opens (`sessionGameUi`). */
export const registerUi = sessionGameUi({
  miniApp: 'snake',
  kind: GAME_KIND,
  title: 'Snake',
  label: 'Snake — play or watch a decision model',
  keywords: ['snake', 'game', 'arcade'],
  Icon: Worm,
  Workspace,
  loading: <LoadingHint>Opening Snake…</LoadingHint>,
  agentContext: {
    description:
      'This chat’s Snake board. The user plays it with the arrow keys, or hands it to a decision model. You never steer; read it with snake action "state" to talk about it.',
    tools: ['snake'],
    nextSteps: ['Read the board with snake action "state".'],
  },
  sessionOf: sessionOfGameUri,
})
