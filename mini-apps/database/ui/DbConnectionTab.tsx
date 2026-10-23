import { useDbConnections } from './model/useDbConnections'
import { DatabaseSidebarView } from './ui/DatabaseSidebar'

/**
 * A stable schema-browser work item for one saved connection.
 * Opening other connections, tables or consoles never replaces this tab.
 */
export function DbConnectionTab({
  sessionId,
  connectionId,
}: {
  /** The chat this tab belongs to — where the consoles and tables it opens go. */
  sessionId: string
  connectionId: string
}) {
  // No ground coat: the hosting pane already paints one, and under the host's macOS glass theme
  // the ground tokens carry alpha — a second pane-sized coat compounds into an opaque slab.
  return (
    <div className="@container h-full min-h-0">
      <DatabaseSidebarView
        sessionId={sessionId}
        connectionModel={useDbConnections()}
        requestedConnectionId={connectionId}
        embedded
        connectionOnly
      />
    </div>
  )
}
