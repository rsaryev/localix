/**
 * The API Client registers one root workspace surface and owns its internal layout.
 *
 * This replaces a left-rail section whose rows opened editor-grid tabs. Keeping the request list
 * beside the active request lets the user choose what to send next without losing the comparison
 * context.
 *
 * Layout:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ environment picker            new · import   │  header
 *   ├───────────────┬──────────────────────────────┤
 *   │ requests      │  url bar                     │
 *   │ (navigator)   │  request editor               │  body
 *   │               │  ───────────────────────────  │
 *   │               │  response                     │
 *   └───────────────┴──────────────────────────────┘
 *      ↑ resizable      ↑ the split is resizable too
 *
 * Both dividers use `usePaneResize` for dragging, keyboard nudging, and persisted widths. A row's
 * menu can still open a request in its own grid tab for side-by-side response comparison.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  snippetMessageBindingDraft,
  type PublishedMessageContext,
  type PublishMessageContext,
} from '@localixai/mini-app-sdk/ui'
import { WorkbenchSash } from '@localixai/kit/button'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { usePaneResize } from '@localixai/kit/pane-resize'
import { RequestTab } from './RequestTab'
import { RestApiSidebar } from './RestApiSidebar'
import { useEnvironments } from './model/useEnvironments'
import { EnvironmentEditor } from './ui/EnvironmentEditor'
import { useApiProblem } from './problems'
import type { RequestsState } from './model/useRequests'
import { apiWorkspaceAgentStateContent } from './model/workspaceAgentContext'

/** The navigator's width. Wide enough for `POST` + a readable name, narrow enough to stay out
 *  of the way; the user's own width wins after the first drag. */
const SIDEBAR = { initial: 228, min: 196, max: 340 }
/** What the request/response body must keep, so a drag can never push the divider off-screen. */
const BODY_RESERVE = 360

export function RestApiWorkspace({
  sessionId,
  requestedName,
  publishMessageContext,
}: {
  /** The chat this workspace belongs to; its project holds the collection shown. */
  sessionId: string
  /** A request named by the anchor that opened this workspace, if any. */
  requestedName?: string
  publishMessageContext?: PublishMessageContext
}) {
  const [selected, setSelected] = useState<string | undefined>(requestedName)
  const [managingEnvironments, setManagingEnvironments] = useState(false)
  const [environmentError, setEnvironmentError] = useState<string | null>(null)
  // Owned here, not in the editor: the editor is mounted only while managing environments, so a
  // failed save reported from inside it stood in the Event Center forever once the person left.
  // Leaving IS the end of that condition, so the message is scoped to the surface being open.
  const environmentProblem = useApiProblem({
    subject: 'Environments',
    message: managingEnvironments ? environmentError : null,
  })
  const container = useRef<HTMLDivElement>(null)
  const environments = useEnvironments(sessionId)
  const [requestsState, setRequestsState] = useState<RequestsState>({
    requests: [],
    folders: [],
    loading: true,
    error: null,
  })
  const [requestContext, setRequestContext] = useState<PublishedMessageContext | null>(null)

  const onRequestsStateChange = useCallback((state: RequestsState) => setRequestsState(state), [])

  // What the previous request (or the environment editor) published is not about the next one.
  // Reset while rendering, when either changes, so nothing the new surface publishes is wiped.
  const [contextFor, setContextFor] = useState({ selected, managingEnvironments })
  if (
    contextFor.selected !== selected ||
    contextFor.managingEnvironments !== managingEnvironments
  ) {
    setContextFor({ selected, managingEnvironments })
    setRequestContext(null)
  }

  const workspaceContext = useMemo(() => {
    return snippetMessageBindingDraft({
      label: 'API Client workspace state',
      content: apiWorkspaceAgentStateContent({
        requestsLoading: requestsState.loading,
        requestsError: requestsState.error,
        requestCount: requestsState.requests.length,
        managingEnvironments,
        environmentsLoading: environments.loading,
        ...(selected ? { selectedRequest: selected } : {}),
        ...(environments.active ? { activeEnvironment: environments.active.name } : {}),
      }),
      language: 'text',
    })
  }, [environments.active, environments.loading, managingEnvironments, requestsState, selected])

  useEffect(() => {
    if (!publishMessageContext) return
    publishMessageContext({
      strategy: 'replace',
      bindings: [...(requestContext?.bindings.slice(0, 4) ?? []), workspaceContext],
    })
  }, [publishMessageContext, requestContext, workspaceContext])

  // The workspace is a SINGLETON tab, so a second "open this request" — from a search hit, an
  // `@`-ref, or the agent's own button — arrives as a new payload on the tab that is already
  // mounted. Without this the link would focus the workspace and leave the previous request on
  // screen, which reads as the link having done nothing.
  const [seenRequestedName, setSeenRequestedName] = useState(requestedName)
  if (requestedName !== seenRequestedName) {
    setSeenRequestedName(requestedName)
    if (requestedName) {
      setSelected(requestedName)
      setManagingEnvironments(false)
    }
  }

  const sidebar = usePaneResize({
    axis: 'x',
    initial: SIDEBAR.initial,
    min: SIDEBAR.min,
    max: SIDEBAR.max,
    storageKey: 'rest-api.sidebar-width',
    containerRef: container,
    reserve: BODY_RESERVE,
  })

  // No ground coat on the workspace root or its sidebar column: the hosting pane already paints
  // one, and under the host's macOS glass theme the ground tokens carry alpha — a second
  // pane-sized coat compounds into an opaque slab (85% over 70% is 95.5%). On the opaque themes
  // the pane's coat is the identical color, so inheriting it changes nothing.
  return (
    <div ref={container} className="@container flex h-full min-h-0">
      <div className="flex min-h-0 shrink-0 flex-col" style={{ width: sidebar.size }}>
        <RestApiSidebar
          sessionId={sessionId}
          activeName={selected}
          environments={environments}
          onManageEnvironments={() => setManagingEnvironments(true)}
          onRequestsStateChange={onRequestsStateChange}
          onSelect={(name) => {
            setSelected(name)
            setManagingEnvironments(false)
          }}
        />
      </div>

      <WorkbenchSash
        label="Resize the request list"
        orientation="vertical"
        className="relative z-(--z-controls) -mx-[calc(var(--sash-hit-area)/2)]"
        valueNow={sidebar.size}
        valueMin={sidebar.min}
        valueMax={sidebar.limit}
        resetLabel="reset the request list width"
        active={sidebar.resizing}
        onPointerDown={sidebar.onResizeStart}
        onKeyDown={sidebar.onResizeKeyDown}
        onDoubleClick={sidebar.reset}
      />

      <div className="min-w-0 flex-1">
        {managingEnvironments ? (
          <EnvironmentEditor
            onError={setEnvironmentError}
            problem={environmentProblem}
            environments={environments.environments}
            onClose={() => setManagingEnvironments(false)}
            onUse={environments.use}
            onCreate={environments.create}
            onUpdate={environments.update}
            onRemove={environments.remove}
            onRename={environments.rename}
            onDuplicate={environments.duplicate}
          />
        ) : selected ? (
          // Keyed by name so switching requests remounts the panes — the editor holds a draft per
          // request, and a draft must never follow the selection onto a different request.
          <RequestTab
            key={selected}
            sessionId={sessionId}
            name={selected}
            publishMessageContext={setRequestContext}
          />
        ) : (
          <EmptyHint>Select or create a request.</EmptyHint>
        )}
      </div>
    </div>
  )
}
