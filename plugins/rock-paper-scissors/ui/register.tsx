import { lazy, Suspense } from 'react'
import { Hand } from 'lucide-react'
import type { PluginUiHost, PublishMessageContext } from '@localixai/plugin-sdk/ui'
import { LoadingHint } from '@localixai/kit/empty-hint'

import { GAME_KIND, sessionOfGameUri } from '../shared/resource'

const Workspace = lazy(() =>
  import('./Workspace').then((module) => ({ default: module.Workspace })),
)

function GameBody({
  visible,
  publishMessageContext,
}: {
  visible: boolean
  publishMessageContext: PublishMessageContext
}) {
  return (
    <Suspense fallback={<LoadingHint>Opening Rock Paper Scissors…</LoadingHint>}>
      <Workspace active={visible} publishMessageContext={publishMessageContext} />
    </Suspense>
  )
}

const registeredHosts = new WeakSet<PluginUiHost>()

/**
 * One table PER CHAT (`scope: 'session'`): the agent in the chat is the opponent, and the table
 * lives and dies with it. The host gives each chat its own tab and closes it when the chat is
 * deleted; the game's data goes with the chat on the server.
 */
export function registerUi(host: PluginUiHost): void {
  if (registeredHosts.has(host)) return
  registeredHosts.add(host)
  host.workItems.register({
    kind: GAME_KIND,
    Component: GameBody,
    Icon: Hand,
    restorable: true,
    scope: 'session',
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
  })
  host.railViewlets.register({
    kind: GAME_KIND,
    title: 'Rock Paper Scissors',
    label: 'Rock Paper Scissors — sealed moves against the agent',
    defaultArea: 'overflow',
    keywords: ['game', 'rock', 'paper', 'scissors', 'roshambo', 'play'],
    Icon: Hand,
  })
  host.anchors.register({
    id: 'rock-paper-scissors:game-anchor',
    namespaces: ['rock-paper-scissors'],
    icons: { game: Hand },
    // A table URI that names its chat opens there (`session`); the bare one, in the chat it is followed from.
    resolve: (uri) => {
      const session = sessionOfGameUri(uri)
      if (session === undefined) return null
      return {
        kind: 'work-item',
        workKind: GAME_KIND,
        id: GAME_KIND,
        title: 'Rock Paper Scissors',
        ...(session ? { session } : {}),
      }
    },
  })
}
