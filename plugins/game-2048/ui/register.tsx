import { lazy, Suspense } from 'react'
import { Grid2x2 } from 'lucide-react'
import type { PluginUiHost, PublishMessageContext } from '@localixai/plugin-sdk/ui'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { GAME_KIND, sessionOfGameUri } from '../shared/resource'

const Workspace = lazy(() =>
  import('./Workspace').then((module) => ({ default: module.Workspace })),
)
const registeredHosts = new WeakSet<PluginUiHost>()

export function registerUi(host: PluginUiHost): void {
  if (registeredHosts.has(host)) return
  registeredHosts.add(host)
  host.workItems.register({
    kind: GAME_KIND,
    Component: ({
      visible,
      publishMessageContext,
    }: {
      visible: boolean
      publishMessageContext: PublishMessageContext
    }) => (
      <Suspense fallback={<LoadingHint>Opening 2048…</LoadingHint>}>
        <Workspace active={visible} publishMessageContext={publishMessageContext} />
      </Suspense>
    ),
    Icon: Grid2x2,
    restorable: true,
    scope: 'session',
    agentContext: {
      description:
        'This chat’s 2048 board. The user chooses who controls it. Use game_2048 to move only when the agent controls it.',
      tools: ['game_2048'],
      nextSteps: [
        'Read the board with game_2048 action "state".',
        'When the agent controls the board, play it with action "move" and a "prefer" order of directions until the game ends.',
      ],
    },
  })
  host.railViewlets.register({
    kind: GAME_KIND,
    title: '2048',
    label: '2048 — play or watch the agent',
    defaultArea: 'overflow',
    keywords: ['2048', 'game', 'puzzle'],
    Icon: Grid2x2,
  })
  host.anchors.register({
    id: 'game-2048:game-anchor',
    namespaces: ['game-2048'],
    icons: { game: Grid2x2 },
    resolve: (uri) => {
      const session = sessionOfGameUri(uri)
      if (session === undefined) return null
      return {
        kind: 'work-item',
        workKind: GAME_KIND,
        id: GAME_KIND,
        title: '2048',
        ...(session ? { session } : {}),
      }
    },
  })
}
