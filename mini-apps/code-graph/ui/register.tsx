import { lazy, Suspense } from 'react'
import { Network } from 'lucide-react'
import {
  resourceMessageBindingDraft,
  type MiniAppUiHost,
  type PublishMessageContext,
} from '@localixai/mini-app-sdk/ui'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { GRAPH_KIND, GRAPH_URI, nodeOfUri, sessionOfGraphUri } from '../shared/resource'

const Workspace = lazy(() =>
  import('./Workspace').then((module) => ({ default: module.Workspace })),
)

function GraphBody({
  visible,
  publishMessageContext,
}: {
  visible: boolean
  publishMessageContext: PublishMessageContext
}) {
  return (
    <Suspense fallback={<LoadingHint>Opening Code Graph…</LoadingHint>}>
      <Workspace active={visible} publishMessageContext={publishMessageContext} />
    </Suspense>
  )
}

const registeredHosts = new WeakSet<MiniAppUiHost>()

/**
 * One map PER CHAT (`scope: 'session'`): a chat has a project, and the map is of that project. The
 * agent in the chat drives the same map through `code_graph_show`, and the tab's published context
 * tells it what the person is looking at.
 */
export function registerUi(host: MiniAppUiHost): void {
  if (registeredHosts.has(host)) return
  registeredHosts.add(host)
  host.workItems.register({
    kind: GRAPH_KIND,
    Component: GraphBody,
    Icon: Network,
    restorable: true,
    scope: 'session',
    toMessageBinding: () => resourceMessageBindingDraft({ uri: GRAPH_URI, label: 'Code graph' }),
    agentContext: {
      description:
        "A map of this chat's project: directories, files and symbols with their imports, calls and inheritance. The published context lists the level on screen and the selected node with its ids.",
      tools: [
        'code_graph_overview',
        'code_graph_search',
        'code_graph_node',
        'code_graph_impact',
        'code_graph_path',
        'code_graph_show',
      ],
      nextSteps: [
        'Explain what the user is looking at from the published context; use the ids it lists with the code_graph tools.',
        'Answer "who uses / what breaks" with code_graph_node and code_graph_impact before reading files.',
        'When walking the user through code, point the map at it with code_graph_show.',
      ],
    },
  })
  host.railViewlets.register({
    kind: GRAPH_KIND,
    title: 'Code Graph',
    label: 'Code Graph — map of the project’s code',
    defaultArea: 'overflow',
    keywords: [
      'code',
      'graph',
      'map',
      'architecture',
      'dependencies',
      'imports',
      'calls',
      'impact',
    ],
    Icon: Network,
  })
  host.anchors.register({
    id: 'code-graph:anchor',
    namespaces: ['code-graph'],
    icons: { graph: Network },
    // A map URI that names its chat opens there. A bare map or node URI names none, so the answer
    // carries no `session` and the host opens it in the chat the link was followed from.
    resolve: (uri) => {
      const session = sessionOfGraphUri(uri)
      if (session === undefined && nodeOfUri(uri) === null) return null
      return {
        kind: 'work-item',
        workKind: GRAPH_KIND,
        id: GRAPH_KIND,
        title: 'Code Graph',
        ...(session ? { session } : {}),
      }
    },
  })
}
