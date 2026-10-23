/** Row views for a connection's objects: schema, Tables/Views group, table, column, index. Each
 *  renders one flat row from the tree model; open state, selection and focus come in as props. */
import type { DragEvent } from 'react'
import {
  Circle,
  Clock,
  Columns3,
  Database,
  Eye,
  KeyRound,
  KeySquare,
  Link2,
  Plus,
  Table2,
} from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import {
  createMessageBindingDraft,
  setMessageBindingDrag,
} from '@localixai/plugin-sdk/ui/message-binding-drag'
import { IconButton } from '@localixai/kit/icon-button'
import { dbResourceUri } from '../../model/dbResourceUri'
import { formatApproxCount } from '../../model/formatApproxCount'
import { formatTtl } from '../../model/formatTtl'
import type {
  ColumnTreeRow,
  GroupTreeRow,
  IndexTreeRow,
  SchemaTreeSchemaRow,
  TableTreeRow,
} from '../../model/schemaTreeRows'
import { DB_BADGE, DB_BADGE_CAPS } from '../dbBadge'
import type { SchemaTreeActions } from './actions'
import { TreeChevron, TreeItem } from './TreeItem'
import { TREE_GLYPH, TREE_LEAF_GLYPH } from './treeRowRecipe'

export interface RowViewProps<R> {
  row: R
  tabIndex: 0 | -1
  selected: boolean
  actions: SchemaTreeActions
}

function dragInto(event: DragEvent, uri: string, label: string) {
  setMessageBindingDrag(event.dataTransfer, createMessageBindingDraft('resource', uri, label))
}

export function SchemaRowView({
  row,
  tabIndex,
  selected,
  actions,
}: RowViewProps<SchemaTreeSchemaRow>) {
  const label = row.schemaName || 'Default schema'
  return (
    <TreeItem row={row} tabIndex={tabIndex} selected={selected} actions={actions}>
      <TreeChevron row={row} label={label} actions={actions} />
      <Database className={TREE_GLYPH} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-2xs tabular-nums text-text-faint">{row.count}</span>
      {row.canCreateTable && actions.createTable && (
        <IconButton
          size="xs"
          tabIndex={tabIndex}
          aria-label={`Create table in ${row.schemaName}`}
          tooltip={`Create table in ${row.schemaName}`}
          className="lx-hover-actions shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={(event) => {
            event.stopPropagation()
            actions.createTable?.(row.connectionId, row.schemaName)
          }}
        >
          <Plus className="size-3" />
        </IconButton>
      )}
    </TreeItem>
  )
}

export function GroupRowView({ row, tabIndex, selected, actions }: RowViewProps<GroupTreeRow>) {
  const label = row.group === 'views' ? 'Views' : 'Tables'
  const Icon = row.group === 'views' ? Eye : Table2
  return (
    <TreeItem row={row} tabIndex={tabIndex} selected={selected} actions={actions}>
      <TreeChevron row={row} label={label} actions={actions} />
      <Icon className={TREE_GLYPH} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-2xs tabular-nums text-text-faint">{row.count}</span>
    </TreeItem>
  )
}

export function TableRowView({ row, tabIndex, selected, actions }: RowViewProps<TableTreeRow>) {
  const { item } = row
  const matched = row.matchReason === 'column' ? row.matchedColumns : null
  return (
    <TreeItem
      row={row}
      tabIndex={tabIndex}
      selected={selected}
      actions={actions}
      draggable
      onDragStart={(event) =>
        dragInto(event, dbResourceUri(row.connectionId, row.uriSchema, item.name), item.name)
      }
      title="Click to open data · use the chevron to expand columns · drag to link into chat"
    >
      <TreeChevron row={row} label={item.name} actions={actions} />
      {item.type === 'view' ? <Eye className={TREE_GLYPH} /> : <Table2 className={TREE_GLYPH} />}
      <span className="min-w-0 flex-1 truncate">{item.name}</span>
      {matched && matched.length > 0 && (
        <span
          className={DB_BADGE}
          title={`Matches ${matched.length} column${matched.length > 1 ? 's' : ''}: ${matched.join(', ')}`}
        >
          <Columns3 className="size-2.5" />
          {matched.length}
        </span>
      )}
      {item.ttl !== undefined && (
        <span
          className="flex shrink-0 items-center gap-0.5 text-2xs tabular-nums text-text-soft"
          title={`Expires in ~${item.ttl.toLocaleString()}s`}
        >
          <Clock className="size-2.5" />
          {formatTtl(item.ttl)}
        </span>
      )}
      {item.badge && (
        <span className={DB_BADGE_CAPS} title={`Type: ${item.badge}`}>
          {item.badge}
        </span>
      )}
      {row.approxRows !== undefined && (
        <span
          className="shrink-0 text-2xs tabular-nums text-text-soft"
          title={`~${row.approxRows.toLocaleString()} rows (approximate, from engine statistics)`}
        >
          {formatApproxCount(row.approxRows)}
        </span>
      )}
    </TreeItem>
  )
}

export function ColumnRowView({ row, tabIndex, selected, actions }: RowViewProps<ColumnTreeRow>) {
  const { column, refTable } = row
  return (
    <TreeItem
      row={row}
      tabIndex={tabIndex}
      selected={selected}
      actions={actions}
      leaf
      draggable
      onDragStart={(event) =>
        dragInto(
          event,
          dbResourceUri(row.connectionId, row.uriSchema, row.table, column.name),
          column.name,
        )
      }
      title={`${column.dataType}${column.nullable ? '' : ' · NOT NULL'}${refTable ? ` · → ${refTable}` : ''} · drag to link into chat`}
    >
      {column.pk ? (
        <KeyRound className={cn(TREE_LEAF_GLYPH, 'text-status-warning')} />
      ) : refTable ? (
        <Link2 className={cn(TREE_LEAF_GLYPH, 'text-status-info')} />
      ) : (
        <Circle className={cn(TREE_LEAF_GLYPH, 'text-text-faint')} />
      )}
      <span className={cn('min-w-0 flex-1 truncate', row.isMatch && 'font-medium text-foreground')}>
        {column.name}
      </span>
      {refTable ? (
        // A sibling BUTTON, not a span pretending to be one inside the row: the jump is reachable
        // by Tab from the focused row, and only from the focused row (it shares the row's stop).
        <button
          type="button"
          tabIndex={tabIndex}
          title={`Open ${refTable}`}
          onClick={(event) => {
            event.stopPropagation()
            actions.openRef(row)
          }}
          className="ml-auto min-w-0 max-w-1/2 truncate rounded-sm text-status-info outline-none hover:underline focus-ring"
        >
          → {refTable}
        </button>
      ) : (
        <span className="ml-auto min-w-0 max-w-1/2 truncate text-text-faint">
          {column.dataType}
        </span>
      )}
    </TreeItem>
  )
}

export function IndexRowView({ row, tabIndex, selected, actions }: RowViewProps<IndexTreeRow>) {
  const { index } = row
  return (
    <TreeItem
      row={row}
      tabIndex={tabIndex}
      selected={selected}
      actions={actions}
      leaf
      title={`${index.name} (${index.columns.join(', ')})${index.unique ? ' · UNIQUE' : ''}${index.primary ? ' · PRIMARY' : ''}`}
    >
      <KeySquare
        className={cn(TREE_LEAF_GLYPH, index.primary ? 'text-status-warning' : 'text-text-faint')}
      />
      <span className="min-w-0 flex-1 truncate">{index.columns.join(', ') || index.name}</span>
      {index.primary ? (
        <span className={cn(DB_BADGE_CAPS, 'bg-status-warning/15 text-status-warning')}>PK</span>
      ) : index.unique ? (
        <span className={DB_BADGE_CAPS}>Unique</span>
      ) : null}
    </TreeItem>
  )
}
