import { TextAction } from '@localixai/kit/text-action'
import { location } from '../../shared/format'
import type { EdgeKind } from '../../shared/model'
import type { NodeDetail, NodeSummaryView } from '../../shared/view'
import { EDGE_LABEL, KIND_ICON, KIND_TINT } from '../kinds'

/**
 * A node's relations in one direction, grouped the way the question is asked ("called by",
 * "imported by"). Each row moves the map to that node, so following a dependency chain is a run of
 * clicks, not searches.
 */
export function Relations({
  title,
  relations,
  more,
  direction,
  onJump,
}: {
  title: string
  relations: NodeDetail['incoming']
  more: number
  direction: 'in' | 'out'
  onJump: (node: NodeSummaryView) => void
}) {
  const groups = new Map<EdgeKind, NodeDetail['incoming']>()
  for (const relation of relations)
    groups.set(relation.kind, [...(groups.get(relation.kind) ?? []), relation])
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-2xs font-medium text-text-soft">{title}</h3>
      {relations.length === 0 && (
        <p className="text-2xs leading-4 text-text-faint">
          {direction === 'in'
            ? 'Nothing the map could resolve. Calls on untyped values are not linked, so this is not proof it is unused.'
            : 'Nothing the map could resolve.'}
        </p>
      )}
      {[...groups].map(([kind, group]) => (
        <div key={kind} className="flex flex-col">
          <div className="pb-0.5 text-3xs text-text-faint">{EDGE_LABEL[kind][direction]}</div>
          {group.map((relation) => (
            <Row
              key={`${kind}:${relation.node.id}`}
              node={relation.node}
              count={relation.count}
              onJump={onJump}
            />
          ))}
        </div>
      ))}
      {more > 0 && (
        <p className="text-3xs text-text-faint">+{more} more — ask the agent for the full list.</p>
      )}
    </section>
  )
}

export function Row({
  node,
  count,
  trailing,
  onJump,
}: {
  node: NodeSummaryView
  count?: number
  trailing?: string
  onJump: (node: NodeSummaryView) => void
}) {
  const Icon = KIND_ICON[node.kind]
  return (
    <TextAction
      className="-mx-1.5 flex w-[calc(100%+0.75rem)] items-center gap-1.5 rounded-md px-1.5 py-1 text-2xs text-text-soft hover:bg-surface-hover hover:text-foreground"
      tooltip={`${location(node)}${count && count > 1 ? ` · ${count} times` : ''}`}
      onClick={() => onJump(node)}
    >
      <Icon aria-hidden className={`size-3 shrink-0 ${KIND_TINT[node.kind]}`} />
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
      {(trailing ?? (count && count > 1 ? `×${count}` : '')) && (
        <span className="shrink-0 font-mono text-3xs text-text-faint tabular-nums">
          {trailing ?? `×${count}`}
        </span>
      )}
    </TextAction>
  )
}
