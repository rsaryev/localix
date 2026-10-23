import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowRight } from 'lucide-react'

import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { Button } from '@localixai/kit/button'
import {
  Canvas,
  CanvasProvider,
  useCameraPlacement,
  useCanvasCamera,
  type CanvasEdgeType,
} from '@localixai/kit/canvas'
import { RefreshAction } from '@localixai/kit/refresh-action'
import { SearchInput } from '@localixai/kit/search-input'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { WorkbenchStatusBar, WorkbenchStatusItem } from '@localixai/kit/workbench-statusbar'
import type { DbConnectionInfo } from '../dbClient'
import { nodeIdentity, type LayoutDirection } from '../model/diagramLayout'
import { diagramLoadPlan, type DiagramObject } from '../model/diagramScope'
import type { SchemaState } from '../model/useSchema'
import type { DatabaseObjectTarget } from './TableDataWorkspace'
import { DiagramStatusChips } from './DiagramStatusChips'
import { DatabaseTableNode, type DiagramNode } from './DiagramTableNode'
import { ObjectErrorState, useObjectProblem } from './ObjectErrorState'
import { PickMenu } from './PickMenu'
import { useDiagramGraph } from './useDiagramGraph'

const nodeTypes = { databaseTable: DatabaseTableNode }
/** A click waits this long for a possible double-click (which opens the table) before focusing. */
const DOUBLE_CLICK_MS = 220

function DiagramCanvas({
  connection,
  schema,
  onOpenTable,
}: {
  connection: DbConnectionInfo
  schema: SchemaState
  onOpenTable: (target: DatabaseObjectTarget) => void
}) {
  const workItemVisible = useWorkItemVisible()
  const camera = useCanvasCamera()
  const [direction, setDirection] = useState<LayoutDirection>('LR')
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [schemaScope, setSchemaScope] = useState('all')
  const focusClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const schemaNames = useMemo(() => Object.keys(schema.schemas ?? {}), [schema.schemas])
  const effectiveSchemaScope =
    schemaScope !== 'all' && schemaNames.includes(schemaScope) ? schemaScope : 'all'
  const objects = useMemo(
    () =>
      Object.entries(schema.schemas ?? {}).flatMap(([schemaName, items]) =>
        effectiveSchemaScope !== 'all' && schemaName !== effectiveSchemaScope
          ? []
          : items.flatMap((item) =>
              item.type === 'table' ? [{ name: item.name, schema: schemaName }] : [],
            ),
      ),
    [effectiveSchemaScope, schema.schemas],
  )
  const { ensureColumns, getTable } = schema
  // Owned here, not inside the failing branch below: the branch disappears the moment the read
  // succeeds, and an owner that unmounts can never settle its Event Center row.
  const schemaProblem = useObjectProblem(`${connection.name} schema`, schema.error, schema.reload, {
    consequence: objects.length === 0 ? 'blocked' : 'stale',
    detail: schema.errorDetail ?? undefined,
  })

  // Typing is filtering, and filtering is a full dagre re-layout — so the query drives the
  // graph (and the scoped column reads) through a deferred value. React keeps the input itself
  // responsive and drops the intermediate results instead of doing the work once per character.
  const deferredQuery = useDeferredValue(query)

  // A focused table's direct references are the one scope a gated diagram can grow from without a
  // search: the focus already has its structure, so its foreign keys name the neighbours to read.
  const focusRefs = useMemo<DiagramObject[]>(() => {
    const focused = objects.find((o) => nodeIdentity(o.schema, o.name) === focusedId)
    const detail = focused ? getTable(focused.name, focused.schema) : undefined
    return (detail?.foreignKeys ?? []).map((fk) => ({
      name: fk.refTable,
      schema: fk.refSchema ?? focused?.schema,
    }))
  }, [focusedId, objects, getTable])
  const plan = useMemo(
    () => diagramLoadPlan(objects, deferredQuery, focusRefs),
    [focusRefs, deferredQuery, objects],
  )

  useEffect(() => {
    if (!workItemVisible || plan.kind === 'gated') return
    ensureColumns(plan.wanted)
  }, [ensureColumns, plan, workItemVisible])

  useEffect(
    () => () => {
      if (focusClickTimer.current) clearTimeout(focusClickTimer.current)
    },
    [],
  )

  const { allTables, allEdges, visibleKey, edges, nodes } = useDiagramGraph({
    objects,
    getTable,
    focusedId,
    query: deferredQuery,
    direction,
  })

  // Fit once per diagram — a new layout direction or a different set of visible tables — never
  // on a poll that brings the same set, and not while the tab is hidden and has no size.
  useCameraPlacement(`${direction}:${visibleKey}`, () => camera.fit())

  const failedTables = objects.filter((object) => schema.getTableError(object.name, object.schema))
  // Counted over what the plan ASKED for: a gated diagram reads nothing, and counting every
  // unread table in a 5,000-table catalogue would pin "Reading 4,850 tables…" there forever.
  const loadingTables =
    plan.kind === 'gated'
      ? 0
      : plan.wanted.filter(
          (object) =>
            !getTable(object.name, object.schema) &&
            !schema.getTableError(object.name, object.schema),
        ).length
  const retryFailedTables = () => {
    for (const object of failedTables) schema.reloadTable(object.name, object.schema)
  }
  const focusedTable = allTables.find(
    (table) => nodeIdentity(table.schema, table.name) === focusedId,
  )
  const scopeRow = (value: string, label: string): MenuEntry => ({
    id: value,
    label,
    selected: value === effectiveSchemaScope,
    onSelect: () => {
      setSchemaScope(value)
      setFocusedId(null)
      setQuery('')
    },
  })

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-soft px-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-foreground">Relationship diagram</div>
          <div className="truncate text-2xs text-text-faint">
            {connection.name} · {allTables.length} tables · {allEdges.length} relationships
          </div>
        </div>
        <SearchInput
          value={query}
          onValueChange={(value) => {
            setQuery(value)
            if (value) setFocusedId(null)
          }}
          placeholder="Find table or column…"
          aria-label="Search relationship diagram"
          size="md"
          inset
          className="ml-auto w-56"
        />
        {schemaNames.length > 1 && (
          <PickMenu
            label={effectiveSchemaScope === 'all' ? 'All schemas' : effectiveSchemaScope}
            aria-label="Diagram schema"
            className="max-w-40"
            entries={[
              scopeRow('all', 'All schemas'),
              { separator: true },
              ...schemaNames.map((name) => scopeRow(name, name)),
            ]}
          />
        )}
        <Button
          size="xs"
          variant="ghost"
          onClick={() => setDirection((current) => (current === 'LR' ? 'TB' : 'LR'))}
          title={direction === 'LR' ? 'Switch to vertical layout' : 'Switch to horizontal layout'}
        >
          {direction === 'LR' ? (
            <ArrowRight className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )}
          {direction === 'LR' ? 'Horizontal' : 'Vertical'}
        </Button>
        <RefreshAction
          size="sm"
          tooltip="Refresh schema"
          tooltipSide="bottom"
          aria-label="Refresh schema"
          onClick={schema.reload}
          busy={schema.loading}
        />
      </header>

      {/* No ground coat: the hosting pane already paints one, and under the host's macOS glass
          theme the ground tokens carry alpha — a second pane-sized coat compounds into an opaque
          slab. The diagram's own nodes keep their `--card` lifts, which do not compound. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {objects.length === 0 && !schema.loading && schemaProblem ? (
          // A failed connection-level introspection is NOT an empty database; saying
          // "no relational tables" for it hides the reason and offers no way back.
          <ObjectErrorState problem={schemaProblem} />
        ) : objects.length === 0 && !schema.loading ? (
          <div className="flex h-full items-center justify-center p-6 text-xs text-text-faint">
            No relational tables to diagram.
          </div>
        ) : plan.kind === 'gated' && nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-xs text-text-faint">
            {plan.total.toLocaleString()} tables are too many to diagram at once. Search table names
            {schemaNames.length > 1 ? ' or pick a schema' : ''} to draw part of it.
          </div>
        ) : nodes.length === 0 && query ? (
          <div className="flex h-full items-center justify-center p-6 text-xs text-text-faint">
            No tables or columns match “{query.trim()}”.
          </div>
        ) : (
          <Canvas<DiagramNode, CanvasEdgeType>
            label={`Relationship diagram of ${connection.name}. Click a table to focus its relationships, double-click to open it`}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            elementsSelectable
            minimap={nodes.length >= 10 && nodes.length <= 100}
            onNodeClick={(_event, node) => {
              if (focusClickTimer.current) clearTimeout(focusClickTimer.current)
              focusClickTimer.current = setTimeout(() => {
                setQuery('')
                setFocusedId((current) => (node.id === current ? null : node.id))
                focusClickTimer.current = null
              }, DOUBLE_CLICK_MS)
            }}
            onNodeDoubleClick={(_event, node) => {
              if (focusClickTimer.current) clearTimeout(focusClickTimer.current)
              focusClickTimer.current = null
              onOpenTable({ table: node.data.table, schema: node.data.schema })
            }}
            overlay={
              <DiagramStatusChips
                focusedTable={focusedTable?.name ?? null}
                onShowAll={() => setFocusedId(null)}
                loadingTables={loadingTables}
                failedTables={failedTables.map((object) => object.name)}
                onRetry={retryFailedTables}
                partialOf={plan.kind === 'all' ? null : plan.total}
              />
            }
          />
        )}
      </div>
      <WorkbenchStatusBar aria-label="Diagram interactions" seam="top">
        <WorkbenchStatusItem className="max-w-none">
          Click a table to focus its direct relationships · double-click to open data and structure
        </WorkbenchStatusItem>
      </WorkbenchStatusBar>
    </main>
  )
}

/** Interactive ERD built from the same normalized schema cache used by completion and the
 * schema tree, on the host's board: its own provider gives this work item its own camera. */
export function DatabaseDiagram(props: {
  connection: DbConnectionInfo
  schema: SchemaState
  onOpenTable: (target: DatabaseObjectTarget) => void
}) {
  return (
    <CanvasProvider>
      <DiagramCanvas {...props} />
    </CanvasProvider>
  )
}
