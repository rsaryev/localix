import { lazy, Suspense } from 'react'
import { LayoutDashboard } from 'lucide-react'
import {
  resourceMessageBindingDraft,
  ActionSurfaceProvider,
  type MiniAppUiHost,
  type PublishMessageContext,
  type UiAnchorWorkItem,
} from '@localixai/mini-app-sdk/ui'
import { LoadingHint } from '@localixai/kit/empty-hint'
import {
  BOARD_FILE,
  parseSpaceUri,
  SPACE_KIND,
  SPACE_TITLE,
  SPACE_TOOLS,
  spaceUri,
} from '../shared/resource'
import { needsContent, subscribeContent } from './contentEligibility'

const SpaceWorkspace = lazy(() =>
  import('./SpaceWorkspace').then((module) => ({ default: module.SpaceWorkspace })),
)

function SpaceBody({ publishMessageContext }: { publishMessageContext?: PublishMessageContext }) {
  return (
    <ActionSurfaceProvider surface="board.element">
      <Suspense fallback={<LoadingHint>Opening the board…</LoadingHint>}>
        <SpaceWorkspace publishMessageContext={publishMessageContext} />
      </Suspense>
    </ActionSurfaceProvider>
  )
}

/**
 * What a board URI opens: the board tab in the chat the URI names. A bare board URI names none, so
 * the answer carries no `session` and the host opens it in the chat the link was followed from.
 */
function resolveSpaceAnchor(uri: string): UiAnchorWorkItem | null {
  const address = parseSpaceUri(uri)
  if (!address) return null
  return {
    kind: 'work-item',
    workKind: SPACE_KIND,
    id: SPACE_KIND,
    title: SPACE_TITLE,
    ...(address.sessionId ? { session: address.sessionId } : {}),
  }
}

const registeredHosts = new WeakSet<MiniAppUiHost>()

/**
 * One board per PROJECT, opened as a tab of a chat (`scope: 'session'`): the chat is how the host
 * knows which project, so two chats of one project open the same board, and a chat of another
 * project opens that project's.
 */
export function registerUi(host: MiniAppUiHost): void {
  if (registeredHosts.has(host)) return
  registeredHosts.add(host)
  host.actions?.register({
    id: 'project-space:add-content',
    label: 'Project Space',
    title: 'Add to Project Space',
    Icon: LayoutDashboard,
    when: needsContent,
    subscribe: subscribeContent,
    run: async (context) => (await import('./content-action')).addContentToSpace(context),
  })

  host.workItems.register({
    kind: SPACE_KIND,
    Component: SpaceBody,
    Icon: LayoutDashboard,
    restorable: true,
    scope: 'session',
    agentContext: {
      description: `The project’s spatial board (Project Space): notes, shapes, frames, sequence diagrams, code snippets and connectors beside live references to the project’s files, folders, images and documents. It is kept in the project at ${BOARD_FILE} and edited by the user and you.`,
      tools: [SPACE_TOOLS.read, SPACE_TOOLS.apply, SPACE_TOOLS.view],
      nextSteps: [
        `Read the board with ${SPACE_TOOLS.read} before you change it; narrow a large one with frame or query.`,
        `Change it with ${SPACE_TOOLS.apply}: a batch of create/update/delete/connect operations, each applied on its own.`,
        'Lay elements out with arrange, align and distribute instead of computing coordinates; group what belongs together.',
        `Show the person something with ${SPACE_TOOLS.view} (focus ids, an area, fit, zoom, pan); it answers with what is now in view.`,
        'To see the board as a picture, open browser with url "mini-app:project-space" and take a screenshot; it has no http address.',
        'Put a file of the project on the board as a file element by its path — never paste its content into a note.',
      ],
    },
    toMessageBinding: (_item, { session }) =>
      session ? resourceMessageBindingDraft({ uri: spaceUri(session), label: SPACE_TITLE }) : null,
  })
  host.railViewlets.register({
    kind: SPACE_KIND,
    title: SPACE_TITLE,
    label: 'Project Space — this project’s board',
    defaultArea: 'bar',
    keywords: ['space', 'whiteboard', 'canvas', 'board', 'diagram', 'notes'],
    Icon: LayoutDashboard,
  })
  host.anchors.register({
    id: 'project-space:anchor',
    namespaces: ['project-space'],
    icons: { 'project-space': LayoutDashboard },
    resolve: resolveSpaceAnchor,
  })
  host.resourceRefIcons.register({ 'project-space': LayoutDashboard })
}
