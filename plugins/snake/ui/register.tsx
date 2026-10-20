import { lazy, Suspense } from 'react'
import { Worm } from 'lucide-react'
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
      <Suspense fallback={<LoadingHint>Opening Snake…</LoadingHint>}>
        <Workspace active={visible} publishMessageContext={publishMessageContext} />
      </Suspense>
    ),
    Icon: Worm,
    restorable: true,
    scope: 'session',
    agentContext: {
      description:
        'This chat’s Snake board. The user plays it with the arrow keys, or hands it to a decision model. You never steer; read it with snake action "state" to talk about it.',
      tools: ['snake'],
      nextSteps: ['Read the board with snake action "state".'],
    },
  })
  host.railViewlets.register({
    kind: GAME_KIND,
    title: 'Snake',
    label: 'Snake — play or watch a decision model',
    defaultArea: 'overflow',
    keywords: ['snake', 'game', 'arcade'],
    Icon: Worm,
  })
  host.anchors.register({
    id: 'snake:game-anchor',
    namespaces: ['snake'],
    icons: { game: Worm },
    resolve: (uri) => {
      const session = sessionOfGameUri(uri)
      if (session === undefined) return null
      return {
        kind: 'work-item',
        workKind: GAME_KIND,
        id: GAME_KIND,
        title: 'Snake',
        ...(session ? { session } : {}),
      }
    },
  })
}
