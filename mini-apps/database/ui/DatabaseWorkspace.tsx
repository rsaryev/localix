import { useState } from 'react'

import { databaseTargetFromUri, type DatabaseArea } from './model/databaseView'
import { useDbConnections } from './model/useDbConnections'
import { DatabaseSidebarView } from './ui/DatabaseSidebar'

/**
 * Root database surface: one persistent navigator and one object workspace.
 *
 * SQL consoles intentionally remain regular editor-grid tabs. The workspace is for
 * choosing a connection, navigating its schema and inspecting table data/structure;
 * it no longer inserts an Overview page between the user and those primary jobs.
 */
export function DatabaseWorkspace({
  sessionId,
  requestedArea,
  requestedConnectionId,
  requestedResourceUri,
}: {
  /** The chat this workspace belongs to — where the tabs it opens go. */
  sessionId: string
  /** Kept in the public payload for restored pre-redesign work items. */
  requestedArea?: DatabaseArea
  requestedConnectionId?: string
  requestedResourceUri?: string
}) {
  const database = useDbConnections()
  const resourceTarget = databaseTargetFromUri(requestedResourceUri)
  const requestedId = requestedConnectionId ?? resourceTarget?.connectionId
  const [focusedConnectionId, setFocusedConnectionId] = useState(requestedId)

  // A new request moves the focus while rendering, not in an effect.
  const [seenRequestedId, setSeenRequestedId] = useState(requestedId)
  if (requestedId !== seenRequestedId) {
    setSeenRequestedId(requestedId)
    if (requestedId) setFocusedConnectionId(requestedId)
  }

  // No ground coat: the hosting pane already paints one, and under the host's macOS glass theme
  // the ground tokens carry alpha — a second pane-sized coat compounds into an opaque slab (85%
  // over 70% is 95.5%, which is why this mini app's pane rendered black). On the opaque themes the
  // pane's coat is the identical color, so inheriting it changes nothing.
  return (
    <div className="@container h-full min-h-0">
      <DatabaseSidebarView
        sessionId={sessionId}
        connectionModel={database}
        requestedConnectionId={focusedConnectionId}
        requestedObjectTarget={resourceTarget ?? undefined}
        initialArea={requestedArea}
        embedded
      />
    </div>
  )
}
