import { Suspense, type ComponentType, type ReactNode } from 'react'

import type { IconComponent, WorkItemAgentContext } from './contrib'
import type { MiniAppUiHost } from './host'
import type { PublishMessageContext } from './message-bindings'

/**
 * The UI registration every chat-table game makes: one board PER CHAT (`scope: 'session'`) — the
 * chat is the table, the agent in it is the opponent, and the board lives and dies with it. The
 * host gives each chat its own tab (opening the board from another chat opens that chat's, it
 * never moves this one) and closes it when the chat is deleted; the game's data goes with the
 * chat on the server. Beside the work item: the launcher in the rail's overflow, and the anchor
 * the game's tool opens — a board URI that names its chat opens there (`session`); the bare one,
 * in the chat it is followed from.
 *
 * Returns the plugin's `registerUi`, which registers once per host however often it is called.
 */
export function sessionGameUi(game: {
  plugin: string
  /** The work item's kind, `<plugin>:game`. */
  kind: string
  title: string
  /** The launcher's label: the title and what the game is. */
  label: string
  keywords: string[]
  Icon: IconComponent
  /** The board — usually `lazy`, so the game's code loads when a board first opens. */
  Workspace: ComponentType<{ active: boolean; publishMessageContext: PublishMessageContext }>
  /** Shown while the board's code loads. */
  loading: ReactNode
  agentContext: WorkItemAgentContext
  /** The session a board URI names, `null` for the bare one, `undefined` for another URI. */
  sessionOf: (uri: string) => string | null | undefined
}): (host: MiniAppUiHost) => void {
  const { kind, title, Icon, Workspace } = game

  function GameBody({
    visible,
    publishMessageContext,
  }: {
    visible: boolean
    publishMessageContext: PublishMessageContext
  }) {
    return (
      <Suspense fallback={game.loading}>
        <Workspace active={visible} publishMessageContext={publishMessageContext} />
      </Suspense>
    )
  }

  const registeredHosts = new WeakSet<MiniAppUiHost>()
  return (host) => {
    if (registeredHosts.has(host)) return
    registeredHosts.add(host)
    host.workItems.register({
      kind,
      Component: GameBody,
      Icon,
      restorable: true,
      scope: 'session',
      agentContext: game.agentContext,
    })
    host.railViewlets.register({
      kind,
      title,
      label: game.label,
      defaultArea: 'overflow',
      keywords: game.keywords,
      Icon,
    })
    host.anchors.register({
      id: `${game.plugin}:game-anchor`,
      namespaces: [game.plugin],
      icons: { game: Icon },
      resolve: (uri) => {
        const session = game.sessionOf(uri)
        if (session === undefined) return null
        return {
          kind: 'work-item',
          workKind: kind,
          id: kind,
          title,
          ...(session ? { session } : {}),
        }
      },
    })
  }
}
