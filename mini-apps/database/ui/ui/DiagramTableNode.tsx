import { memo } from 'react'
import { Columns3, KeyRound, Link2 } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Handle, Position, type Node, type NodeProps } from '@localixai/kit/canvas'
import type { DbTableSchema } from '../dbClient'
import { NODE_HEADER_HEIGHT, NODE_WIDTH, ROW_HEIGHT } from '../model/diagramLayout'

/**
 * One table on the relationship diagram: its keys first, a capped list of the rest.
 *
 * Its size is the layout's: dagre places the box from `NODE_WIDTH`, `NODE_HEADER_HEIGHT` and
 * `ROW_HEIGHT`, and every edge anchors to a row's centre. The card used to restate them as pixel
 * classes, two copies of one measurement that nothing kept equal; it now reads the layout's own.
 */
const MAX_PLAIN_COLUMNS = 10

interface DiagramColumn {
  name: string
  dataType: string
  pk: boolean
  fk: boolean
}

export interface DiagramNodeData extends Record<string, unknown> {
  table: string
  schema?: string
  columns: DiagramColumn[]
  hiddenColumns: number
  focused: boolean
}

export type DiagramNode = Node<DiagramNodeData, 'databaseTable'>

/** Keep relationship endpoints visible even on very wide tables. Other fields are capped,
 * matching professional ERDs where keys provide the navigational overview and the table tab
 * owns the exhaustive structure. */
export function visibleColumns(
  table: DbTableSchema,
  incoming: Set<string>,
): {
  columns: DiagramColumn[]
  hiddenColumns: number
} {
  const foreign = new Set(table.foreignKeys.flatMap((key) => key.columns))
  const important = new Set([
    ...table.columns.flatMap((column) => (column.pk ? [column.name] : [])),
    ...foreign,
    ...incoming,
  ])
  const selected =
    table.columns.length <= MAX_PLAIN_COLUMNS
      ? table.columns
      : [
          ...table.columns.filter((column) => important.has(column.name)),
          ...table.columns
            .filter((column) => !important.has(column.name))
            .slice(0, Math.max(0, MAX_PLAIN_COLUMNS - important.size)),
        ]
  return {
    columns: selected.map((column) => ({
      name: column.name,
      dataType: column.dataType,
      pk: column.pk,
      fk: foreign.has(column.name),
    })),
    hiddenColumns: Math.max(0, table.columns.length - selected.length),
  }
}

export const DatabaseTableNode = memo(function DatabaseTableNode({ data }: NodeProps<DiagramNode>) {
  return (
    <div
      className={cn(
        // `--card`, not `bg-background`: the diagram canvas already paints that ground, so the
        // once-only rule cleared it under glass and every node card lost its fill over the grid.
        // `--card` is the element-sized LIFT token, which is what a node on a canvas is.
        'overflow-hidden rounded-lg border bg-card shadow-(--shadow-raised) transition-[border-color,box-shadow]',
        data.focused
          ? 'border-status-info/70 shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-status-info)_15%,transparent)]'
          : 'border-border-soft hover:border-control-border-hover',
      )}
      style={{ width: NODE_WIDTH }}
      title="Click to focus relationships · double-click to open table"
    >
      <div
        // Foreground veil, not `bg-surface-raised`: raised is the SUNKEN inset token, so on the
        // `--card` lift the header read as a dark slot cut into the node instead of its title bar.
        className="flex items-center gap-2 border-b border-border-soft bg-foreground/[0.04] px-3"
        style={{ height: NODE_HEADER_HEIGHT }}
      >
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            data.focused ? 'bg-status-info' : 'bg-text-faint/55',
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-foreground">{data.table}</div>
          {data.schema && (
            <div className="truncate text-3xs leading-3 text-text-faint">{data.schema}</div>
          )}
        </div>
      </div>
      <div>
        {data.columns.map((column) => (
          <div
            key={column.name}
            className={cn(
              'relative flex min-w-0 items-center gap-1.5 border-b border-border-faint px-2.5 text-2xs last:border-b-0',
              column.pk && 'bg-status-warning/[0.035]',
            )}
            style={{ height: ROW_HEIGHT }}
          >
            <Handle
              id={column.name}
              type="target"
              position={Position.Left}
              className="!left-[-4px] !size-1.5 !border !border-background !bg-text-faint/70"
            />
            {column.pk ? (
              <KeyRound className="size-2.5 shrink-0 text-status-warning" />
            ) : column.fk ? (
              <Link2 className="size-2.5 shrink-0 text-status-info" />
            ) : (
              <Columns3 className="size-2.5 shrink-0 text-text-faint/60" />
            )}
            <span
              className={cn(
                'min-w-0 flex-1 truncate font-mono text-text-soft',
                column.pk && 'font-medium text-foreground',
              )}
            >
              {column.name}
            </span>
            <span className="max-w-24 shrink-0 truncate font-mono text-3xs text-text-faint">
              {column.dataType}
            </span>
            <Handle
              id={column.name}
              type="source"
              position={Position.Right}
              className="!right-[-4px] !size-1.5 !border !border-background !bg-status-info/80"
            />
          </div>
        ))}
        {data.hiddenColumns > 0 && (
          <div
            className="flex items-center px-2.5 text-3xs text-text-faint"
            style={{ height: ROW_HEIGHT }}
          >
            +{data.hiddenColumns} more columns
          </div>
        )}
      </div>
    </div>
  )
})
