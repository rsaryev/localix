import { lazy, Suspense } from 'react'
import { CircleDot } from 'lucide-react'
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
    <Suspense fallback={<LoadingHint>Opening Checkers…</LoadingHint>}>
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
    Icon: CircleDot,
    restorable: true,
    scope: 'session',
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
  })
  host.railViewlets.register({
    kind: GAME_KIND,
    title: 'Checkers',
    label: 'Checkers — play against the agent',
    defaultArea: 'overflow',
    keywords: ['game', 'checkers', 'draughts', 'play'],
    Icon: CircleDot,
  })
  host.anchors.register({
    id: 'checkers:game-anchor',
    namespaces: ['checkers'],
    icons: { game: CircleDot },
    // A board URI that names its chat opens there (`session`); the bare one, in the chat it is followed from.
    resolve: (uri) => {
      const session = sessionOfGameUri(uri)
      if (session === undefined) return null
      return {
        kind: 'work-item',
        workKind: GAME_KIND,
        id: GAME_KIND,
        title: 'Checkers',
        ...(session ? { session } : {}),
      }
    },
  })
}
