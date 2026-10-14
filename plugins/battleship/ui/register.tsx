import { lazy, Suspense } from 'react'
import { Ship } from 'lucide-react'
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
    <Suspense fallback={<LoadingHint>Opening Battleship…</LoadingHint>}>
      <Workspace active={visible} publishMessageContext={publishMessageContext} />
    </Suspense>
  )
}

const registeredHosts = new WeakSet<PluginUiHost>()

/**
 * One board PER CHAT (`scope: 'session'`): the chat is the table, the agent in it is the opponent,
 * and the board lives and dies with it. The host gives each chat its own tab (opening the board
 * from another chat opens that chat's, it never moves this one) and closes it when the chat is
 * deleted; the game's data goes with the chat on the server.
 */
export function registerUi(host: PluginUiHost): void {
  if (registeredHosts.has(host)) return
  registeredHosts.add(host)
  host.workItems.register({
    kind: GAME_KIND,
    Component: GameBody,
    Icon: Ship,
    restorable: true,
    scope: 'session',
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
  })
  host.railViewlets.register({
    kind: GAME_KIND,
    title: 'Battleship',
    label: 'Battleship — play against the agent',
    defaultArea: 'overflow',
    keywords: ['game', 'battleship', 'sea battle', 'ships', 'play'],
    Icon: Ship,
  })
  host.anchors.register({
    id: 'battleship:game-anchor',
    namespaces: ['battleship'],
    icons: { game: Ship },
    // A board URI that names its chat opens there (`session`); the bare one, in the chat it is followed from.
    resolve: (uri) => {
      const session = sessionOfGameUri(uri)
      if (session === undefined) return null
      return {
        kind: 'work-item',
        workKind: GAME_KIND,
        id: GAME_KIND,
        title: 'Battleship',
        ...(session ? { session } : {}),
      }
    },
  })
}
