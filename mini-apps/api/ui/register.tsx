/**
 * UI registration for the bundled API Client subsystem.
 *
 * The mini app contributes ONE workspace (a rail VIEWLET → one grid tab per chat, since the
 * collection lives in that chat's project) plus the per-request tab kind a user can pop out of it,
 * through the {@link MiniAppUiHost} façade (the
 * mini app SDK contract). It is discovered + invoked generically by `shared/contrib/discover.ts`.
 *
 * It used to register a rail SECTION whose rows opened tabs, which made it the last mini app in the
 * app on that shape — Database, Trading, DevOps and Learning are all viewlets. The
 * workspace is `RestApiWorkspace`; see its header for why a REST client in particular needs the
 * list and the request on screen together.
 */

import { lazy, Suspense } from 'react'
import { Globe, KeyRound, Send } from 'lucide-react'

import {
  type FileEditorProps,
  resourceMessageBindingDraft,
  type MessageContextBindingDraft,
  type MiniAppUiHost,
  type PublishMessageContext,
  type WorkItemLike,
} from '@localixai/mini-app-sdk/ui'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { buildRequestUri, parseRestUri } from '../backend/uri'
import { REQUEST_WORK_KIND } from './model/openTab'
import { initApiWorkspaceCommands } from './model/collectionEvents'
import { useApiEnvironmentStatusItem } from './statusItem'

/** The workspace's `WorkItemKind`, which is also its singleton tab id (the viewlet contract). */
const WORKSPACE_KIND = 'api:workspace'

const RequestTabLazy = lazy(() => import('./RequestTab').then((m) => ({ default: m.RequestTab })))

// The whole client graph — navigator, editors, response viewers — stays off the eager entry
// chunk; only this registration file is loaded at boot.
const RestApiWorkspaceLazy = lazy(() =>
  import('./RestApiWorkspace').then((m) => ({ default: m.RestApiWorkspace })),
)

/**
 * Adapt the generic WorkItem body props to the workspace's own props (reads `payload`).
 *
 * The collection is a directory in a chat's PROJECT, so the workspace is a session tab and acts for
 * the chat it was opened in (`useWorkItemSessionId`). It used to be one global tab that followed
 * the active chat, so a send or a save from a workspace still on screen landed in whichever
 * project was focused. A tab with no session has no collection to show.
 */
function RestApiWorkspaceBody({
  item,
  publishMessageContext,
}: {
  item: WorkItemLike
  publishMessageContext: PublishMessageContext
}) {
  const sessionId = useWorkItemSessionId()
  if (!sessionId) return <EmptyHint>Open the API Client from a chat.</EmptyHint>
  return (
    <Suspense fallback={<LoadingHint>Opening API Client…</LoadingHint>}>
      <RestApiWorkspaceLazy
        sessionId={sessionId}
        requestedName={item.payload?.name as string | undefined}
        publishMessageContext={publishMessageContext}
      />
    </Suspense>
  )
}

/** Adapt the generic WorkItem body props to the popped-out request tab's own props. */
function RequestTabBody({
  item,
  publishMessageContext,
}: {
  item: WorkItemLike
  publishMessageContext: PublishMessageContext
}) {
  const sessionId = useWorkItemSessionId()
  if (!sessionId) return <EmptyHint>Open this request from a chat.</EmptyHint>
  return (
    <Suspense fallback={<LoadingHint>Opening request…</LoadingHint>}>
      <RequestTabLazy
        key={item.id}
        sessionId={sessionId}
        name={(item.payload?.name as string) ?? item.title}
        publishMessageContext={publishMessageContext}
      />
    </Suspense>
  )
}

/** Resolve a typed request file back to the request name used by routes and resource bindings. */
export function requestNameFromFilePath(filePath: string): string | undefined {
  const normalized = filePath.replace(/\\/g, '/')
  const lower = normalized.toLowerCase()
  const marker = '/.localix/api/'
  const markerAt = lower.lastIndexOf(marker)
  const suffix = '.request.json'
  if (markerAt < 0 || !lower.endsWith(suffix)) return undefined
  const relative = normalized.slice(markerAt + marker.length, -suffix.length)
  if (!relative || relative.startsWith('.') || relative.startsWith('environments/'))
    return undefined
  return relative
}

/** A request file is one request, so opening it skips the collection sidebar. */
function RequestFileBody({ path, sessionId, publishMessageContext }: FileEditorProps) {
  const name = requestNameFromFilePath(path)
  // A final state, not a pending one: LoadingHint here painted an activity orb that never settled.
  if (!name) return <EmptyHint>Not a saved API request.</EmptyHint>
  return (
    <Suspense fallback={<LoadingHint>Opening request…</LoadingHint>}>
      <RequestTabLazy
        sessionId={sessionId}
        name={name}
        publishMessageContext={publishMessageContext}
      />
    </Suspense>
  )
}

/** A request tab drags into chat as its `localix://resource/api/…` ref — the backend's own grammar. */
function requestToMessageBinding(item: WorkItemLike): MessageContextBindingDraft | null {
  const name = item.payload?.name as string | undefined
  if (!name) return null
  const uri = buildRequestUri(name)
  return resourceMessageBindingDraft({ uri, label: name })
}

let registered = false

/** Test-only reset; production activation remains idempotent. */
export function __resetApiUiRegistration(): void {
  registered = false
}

export function registerUi(host: MiniAppUiHost): void {
  if (registered) return
  registered = true

  // Agent saves/imports/environment switches update an already-open workspace immediately. The
  // slow poll remains only as recovery for filesystem edits and hosts without command streams.
  initApiWorkspaceCommands()

  host.workItems.register({
    kind: WORKSPACE_KIND,
    Component: RestApiWorkspaceBody,
    Icon: Globe,
    restorable: true,
    agentContext: {
      description: 'Saved HTTP requests, environments, request editors, and responses.',
      tools: ['api_client'],
      nextSteps: [
        'Call api_client with {"action":"list"} to list saved requests.',
        'Call api_client with {"action":"list","target":"environment"} before choosing a deployment.',
        'For two or more operations, call api_client once with action=batch and ordered operations; never call it once per request.',
      ],
    },
  })

  host.fileEditors.register({
    id: 'api:request-file',
    label: 'API Client',
    match: (path) => path.toLowerCase().endsWith('.request.json'),
    Component: RequestFileBody,
  })

  // A request POPPED OUT of the workspace. Same editor, its own tab — for reading two responses
  // side by side, which one workspace body cannot do. The database mini app's SQL consoles are the
  // same arrangement.
  host.workItems.register({
    kind: REQUEST_WORK_KIND,
    Component: RequestTabBody,
    Icon: Send,
    restorable: true,
    toMessageBinding: requestToMessageBinding,
    agentContext: (item) => ({
      description: `Popped-out saved API request: ${(item.payload?.name as string | undefined) ?? item.title}.`,
      tools: ['api_client'],
      nextSteps: [
        'Inspect the saved specification with api_client action=get.',
        'Send it only when the user wants a real HTTP request.',
        'Save edits without claiming that saving tested the endpoint.',
      ],
    }),
    // Number a request's additional tabs, and keep them beside each other in the grid.
    siblingGroupKey: () => REQUEST_WORK_KIND,
  })

  // The active environment in the titlebar — which deployment the next send will hit.
  host.statusItems.register({
    id: 'api:environment',
    placement: 'titlebar',
    useItem: useApiEnvironmentStatusItem,
  })

  host.railViewlets.register({
    kind: WORKSPACE_KIND,
    title: 'API Client',
    label: 'API Client — saved requests, environments & responses',
    defaultArea: 'overflow',
    keywords: [
      'workspace',
      'rest',
      'api',
      'http',
      'request',
      'curl',
      'endpoint',
      'insomnia',
      'postman',
      'openapi',
      'graphql',
    ],
    Icon: Globe,
  })

  host.search.register({
    // Must equal the BACKEND search provider's id — the registry groups hits by it.
    id: 'api:requests',
    scope: {
      label: 'API',
      prefix: 'rest',
      aliases: ['request', 'api'],
      icon: 'request',
      placeholder: 'Search saved requests…',
      // Not lazy: the backend provider is eager (its corpus is one small local file), and a scope
      // that declared otherwise would hide our hits from a default "search everything".
    },
    icons: { request: Send },
  })
  host.anchors.register({
    id: 'api:requests',
    namespaces: ['api'],
    icons: { request: Send, auth: KeyRound },
    resolve: (id) => {
      const node = parseRestUri(id)
      if (!node) return null
      // Both levels land in the WORKSPACE — a search hit, an `@`-ref and an agent's "open this"
      // button all bring the user to the same surface, with the named request selected. Only a
      // deliberate pop-out from a row's menu produces a per-request tab, so a link can never
      // scatter tabs the user did not ask for.
      return {
        kind: 'work-item',
        workKind: WORKSPACE_KIND,
        id: WORKSPACE_KIND,
        title: 'API Client',
        payload: node.kind === 'request' ? { name: node.name } : {},
      }
    },
  })
}
