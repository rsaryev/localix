import { Database, FolderTree, Table2, Eye, Columns3, Network } from 'lucide-react'

import {
  resourceMessageBindingDraft,
  localixUriNamespace,
  type MiniAppUiHost,
  type WorkItemLike,
} from '@localixai/mini-app-sdk/ui'
import { isDatabaseFilePath } from '../shared/database-file'
import { connectionTextClass } from './model/connectionColor'
import { useDatabaseStatusItem } from './statusItem'
import { initDatabaseChanges } from './model/databaseChanges'
import { saveDatabaseArea } from './model/databaseView'
import {
  DB_CONNECTION_KIND,
  DB_CONSOLE_KIND,
  DB_DIAGRAM_KIND,
  DB_TABLE_KIND,
  consolePrefix,
} from './model/openConsole'
import { dbConnectionResourceUri } from './model/dbResourceUri'
import {
  DatabaseLifecycle,
  DatabaseWorkspaceBody,
  DbConnectionBody,
  DbConsoleBody,
  DbDiagramBody,
  DbFileEditorBody,
  DbTableBody,
  SqlFileEditorBody,
} from './workItemBodies'

/** Tab-strip icon tint by the connection's color tag. */
const connectionTint = (item: WorkItemLike) =>
  connectionTextClass(item.payload?.color as string | undefined)

/** A tab that carries a `localix://resource/db/…` URI links exactly that resource to chat. */
function dbResourceBinding(item: WorkItemLike) {
  const uri = item.payload?.resourceUri
  if (typeof uri !== 'string' || localixUriNamespace(uri) !== 'db') return null
  return resourceMessageBindingDraft({ uri, label: item.title })
}

/**
 * UI registration for the bundled Database workbench. Contributes its editor-grid
 * `db-console` WorkItem kind, its root Database Workspace, its global-search hit
 * activation, its `@resource:localix://resource/db` node glyphs, and the `.sql`-file editor into the OPEN
 * contrib registries — so core hardcodes the workbench nowhere. Discovered + invoked
 * generically by `shared/contrib/discover.ts` (`registerUi` export), mirroring the bundled
 * container / cluster workbench mini apps. The bodies themselves live in `workItemBodies.tsx`.
 */

let registered = false
const DATABASE_AGENT_CONTEXT = {
  description: 'Database connections, schema objects, SQL consoles, tables, and diagrams.',
  tools: ['database_client'],
  nextSteps: [
    'See connections with database_client action="connections"; add one the user asks for with action="connect".',
    'Inspect tables with action="schema", one table’s columns and keys with action="schema" + table.',
    'Sample rows with action="browse"; use action="query" only for the operation the user requested.',
  ],
}

export function registerUi(host: MiniAppUiHost): void {
  if (registered) return
  registered = true
  // The agent's writes (a connection, a table, rows) reach the workbench without a reload.
  initDatabaseChanges()

  host.workItems.register({
    kind: 'database:workspace',
    Component: DatabaseWorkspaceBody,
    Icon: Database,
    restorable: true,
    agentContext: DATABASE_AGENT_CONTEXT,
  })

  host.workItems.register({
    kind: DB_CONNECTION_KIND,
    Component: DbConnectionBody,
    Icon: Database,
    restorable: true,
    iconTint: connectionTint,
    agentContext: DATABASE_AGENT_CONTEXT,
    toMessageBinding: dbResourceBinding,
  })

  host.workItems.register({
    kind: DB_CONSOLE_KIND,
    Component: DbConsoleBody,
    Icon: Database,
    restorable: true,
    iconTint: connectionTint,
    agentContext: DATABASE_AGENT_CONTEXT,
    // Dragging a console tab onto chat links its connection as `@resource:localix://resource/db/<id>`.
    toMessageBinding: (item) => {
      const connectionId = item.payload?.connectionId
      if (typeof connectionId !== 'string' || !connectionId) return null
      const uri = dbConnectionResourceUri(connectionId)
      return resourceMessageBindingDraft({ uri, label: item.title })
    },
    // Number a connection's additional consoles ("app", "app 2", …).
    siblingGroupKey: (item) => {
      const connectionId = item.payload?.connectionId
      return typeof connectionId === 'string' && connectionId ? consolePrefix(connectionId) : null
    },
  })

  host.workItems.register({
    kind: DB_TABLE_KIND,
    Component: DbTableBody,
    Icon: Table2,
    restorable: true,
    iconTint: connectionTint,
    agentContext: DATABASE_AGENT_CONTEXT,
    toMessageBinding: dbResourceBinding,
  })

  host.workItems.register({
    kind: DB_DIAGRAM_KIND,
    Component: DbDiagramBody,
    Icon: Network,
    restorable: true,
    iconTint: connectionTint,
    agentContext: DATABASE_AGENT_CONTEXT,
    toMessageBinding: dbResourceBinding,
  })

  // The live connection in the titlebar, and its writability — what a query is about to touch.
  host.statusItems.register({
    id: 'database:connection',
    placement: 'titlebar',
    useItem: useDatabaseStatusItem,
  })

  host.railViewlets.register({
    kind: 'database:workspace',
    title: 'Database',
    label: 'Database — connections, schema & query consoles',
    defaultArea: 'overflow',
    keywords: [
      'workspace',
      'sql',
      'connections',
      'schema',
      'console',
      'query',
      'database',
      'db',
      'redis',
      'mongodb',
      'elasticsearch',
    ],
    Icon: Database,
    Mount: DatabaseLifecycle,
  })

  host.search.register({
    id: 'database:search',
    scope: {
      label: 'Databases',
      prefix: 'db',
      aliases: ['sql'],
      icon: 'database',
      placeholder: 'Search connections & schema…',
    },
    icons: { database: Database },
  })

  // A database URI opens Explorer and focuses its connection for every anchor consumer.
  host.anchors.register({
    id: 'database:anchor',
    namespaces: ['db'],
    icons: {
      connection: Database,
      schema: FolderTree,
      table: Table2,
      view: Eye,
      column: Columns3,
    },
    resolve: (id) => {
      if (localixUriNamespace(id) !== 'db') return null
      saveDatabaseArea('explorer')
      return {
        kind: 'work-item',
        workKind: 'database:workspace',
        id: 'database:workspace',
        title: 'Database',
        payload: { area: 'explorer', resourceUri: id },
      }
    },
  })

  // A `.sql` file opens in the database-aware editor (schema autocomplete + Run).
  host.fileEditors.register({
    id: 'database:sql-editor',
    label: 'SQL console',
    match: (p) => p.toLowerCase().endsWith('.sql'),
    Component: SqlFileEditorBody,
  })

  // A database FILE (`localix.db`, `app.sqlite`, `scratch.db3`) opens as a
  // connection — its schema browser, not the code editor's view of its page bytes.
  // The same extensions this mini app declares to the OS in its mini app manifest (`mini-app.json`)
  // (`fileAssociations`), so a double-click in Finder and a click in the file tree
  // land in the same place. No `acceptsMedia`: a dropped/uploaded blob has no path
  // for the server to open, and a database is not something to read into memory.
  host.fileEditors.register({
    id: 'database:file-editor',
    label: 'Database browser',
    match: isDatabaseFilePath,
    Component: DbFileEditorBody,
  })
}
