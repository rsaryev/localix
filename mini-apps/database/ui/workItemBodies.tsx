import { lazy, Suspense } from 'react'

import type {
  FileEditorProps,
  PublishMessageContext,
  WorkItemLike,
} from '@localixai/mini-app-sdk/ui'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { DIALECT_KIND } from './model/dialects'
import { normalizeDatabaseArea } from './model/databaseView'
import { useConsoleDraftCleanup } from './model/useConsoleDraftCleanup'
import type { ConnectionColor, DbDialect } from './dbClient'
import { readConsoleItem, readTableItem } from './workItemPayload'

/**
 * The WorkItem bodies `registerUi` contributes. Each adapts a restored item's payload to its
 * lazily loaded tab, so registration (register.tsx) stays a list of contributions and the heavy
 * editor surfaces load only when a tab of that kind first opens.
 */

const DbConsoleTab = lazy(() => import('./DbConsoleTab').then((m) => ({ default: m.DbConsoleTab })))
const DbConnectionTab = lazy(() =>
  import('./DbConnectionTab').then((m) => ({ default: m.DbConnectionTab })),
)
const DbTableTab = lazy(() => import('./DbTableTab').then((m) => ({ default: m.DbTableTab })))
const DbDiagramTab = lazy(() => import('./DbDiagramTab').then((m) => ({ default: m.DbDiagramTab })))
/** The non-SQL consoles share one prop shape, so each engine kind maps straight to its tab. */
const ENGINE_CONSOLE_TABS = {
  kv: lazy(() => import('./KvConsoleTab').then((m) => ({ default: m.KvConsoleTab }))),
  document: lazy(() => import('./DocConsoleTab').then((m) => ({ default: m.DocConsoleTab }))),
  search: lazy(() => import('./EsConsoleTab').then((m) => ({ default: m.EsConsoleTab }))),
}
/** The `.sql` file editor takes FileEditorProps as-is, so its lazy tab IS the body. */
export const SqlFileEditorBody = lazy(() =>
  import('./SqlFileTab').then((m) => ({ default: m.SqlFileTab })),
)
const DbFileTab = lazy(() => import('./DbFileTab').then((m) => ({ default: m.DbFileTab })))
const DatabaseWorkspaceLazy = lazy(() =>
  import('./DatabaseWorkspace').then((m) => ({ default: m.DatabaseWorkspace })),
)

/**
 * Every database tab belongs to a chat: a console predicts edits for its chat, and the other tabs
 * open consoles and tables into theirs. The tab's own session is the only answer — the host
 * provides it — and a tab with none has nothing to act for, so it says so instead of guessing.
 */
const NO_CHAT = <EmptyHint>Open the database from a chat.</EmptyHint>

export function DatabaseWorkspaceBody({ item }: { item: WorkItemLike }) {
  const sessionId = useWorkItemSessionId()
  const requestedArea =
    typeof item.payload?.area === 'string' ? normalizeDatabaseArea(item.payload.area) : undefined
  const requestedResourceUri =
    typeof item.payload?.resourceUri === 'string' ? item.payload.resourceUri : undefined
  if (!sessionId) return NO_CHAT
  return (
    <Suspense fallback={<LoadingHint>Opening Database Workspace…</LoadingHint>}>
      <DatabaseWorkspaceLazy
        sessionId={sessionId}
        requestedArea={requestedArea}
        requestedResourceUri={requestedResourceUri}
      />
    </Suspense>
  )
}

/** App-lifetime lifecycle: drop an extra console's persisted editor draft on tab close. */
export function DatabaseLifecycle() {
  useConsoleDraftCleanup()
  return null
}

/**
 * Render a `db-console` WorkItem to the console surface for its engine kind: the full SQL
 * console for SQL engines, or the KV / document / search console for the non-SQL engines.
 */
export function DbConsoleBody({
  item,
  publishMessageContext,
}: {
  item: WorkItemLike
  publishMessageContext: PublishMessageContext
}) {
  const sessionId = useWorkItemSessionId()
  const { consoleId, connectionId, dialect, readonly, dbLabel } = readConsoleItem(item)
  const kind = DIALECT_KIND[dialect]
  // The consoles read their chat themselves (`useSqlNextEdit`, `useDbConsoleCommands`).
  if (!sessionId) return NO_CHAT
  if (kind !== 'sql') {
    const EngineConsoleTab = ENGINE_CONSOLE_TABS[kind]
    return (
      <EngineConsoleTab
        key={item.id}
        consoleId={consoleId}
        connectionId={connectionId}
        dbLabel={dbLabel}
        publishMessageContext={publishMessageContext}
      />
    )
  }
  return (
    <DbConsoleTab
      key={item.id}
      consoleId={consoleId}
      connectionId={connectionId}
      dialect={dialect}
      readonly={readonly}
      dbLabel={dbLabel}
      publishMessageContext={publishMessageContext}
    />
  )
}

export function DbConnectionBody({ item }: { item: WorkItemLike }) {
  const sessionId = useWorkItemSessionId()
  const connectionId = (item.payload?.connectionId as string) ?? ''
  if (!sessionId) return NO_CHAT
  return <DbConnectionTab key={item.id} sessionId={sessionId} connectionId={connectionId} />
}

/** Render a dedicated table data/structure work item. */
export function DbTableBody({
  item,
  publishMessageContext,
}: {
  item: WorkItemLike
  publishMessageContext: PublishMessageContext
}) {
  const sessionId = useWorkItemSessionId()
  if (!sessionId) return NO_CHAT
  return (
    <DbTableTab
      key={item.id}
      sessionId={sessionId}
      publishMessageContext={publishMessageContext}
      {...readTableItem(item)}
    />
  )
}

export function DbDiagramBody({ item }: { item: WorkItemLike }) {
  const sessionId = useWorkItemSessionId()
  const connectionId = (item.payload?.connectionId as string) ?? ''
  if (!sessionId) return NO_CHAT
  return (
    <DbDiagramTab
      key={item.id}
      sessionId={sessionId}
      connectionId={connectionId}
      connectionName={(item.payload?.connectionName as string) ?? connectionId}
      dialect={(item.payload?.dialect as DbDialect) ?? 'sqlite'}
      readonly={(item.payload?.readonly as boolean) ?? false}
      color={item.payload?.color as ConnectionColor | undefined}
    />
  )
}

/** Adapt the grid's FileEditorProps to the database-file tab's props. */
export function DbFileEditorBody({ path, sessionId }: FileEditorProps) {
  return <DbFileTab path={path} sessionId={sessionId} />
}
