import {
  snippetMessageBindingDraft,
  type PublishedMessageContext,
} from '@localixai/mini-app-sdk/ui'
import { nodeLine } from '../shared/format'
import type { GraphSnapshot } from '../shared/view'
import { EDGE_LABEL } from './kinds'

/**
 * What the person is looking at, as the agent's context: the level on screen and the selected
 * node's relations — exactly the snapshot drawn, never a separately fetched one, so the agent can
 * say "the box you selected" and mean the same box. The ids are the ones the tools accept.
 *
 * This is the only way the map reaches the chat. There is no "add to chat" button: a workbench
 * surface publishes its visible state, the host attaches it, and a move to another folder
 * replaces it — context that has to be added by hand is context that goes stale by hand.
 */
const MAX_CHILDREN = 15
const MAX_RELATIONS = 12
/** The function being read in the lens goes into the context too — it is what the person sees. */
const MAX_CODE_LINES = 80

export function graphMessageContext(snapshot: GraphSnapshot): PublishedMessageContext | null {
  const { view, selection } = snapshot
  if (!view) return null
  const lines = [
    `Code Graph of ${snapshot.project}, showing ${view.scope.id} (tools: code_graph_search, code_graph_node, code_graph_impact, code_graph_path, code_graph_show, code_graph_view).`,
  ]
  const children = view.nodes
    .filter((node) => node.role === 'child')
    .sort((a, b) => b.dependents - a.dependents)
  lines.push(
    `On screen (${children.length}${view.truncated ? ` of ${children.length + view.truncated}` : ''}):`,
  )
  for (const node of children.slice(0, MAX_CHILDREN)) lines.push(`  ${nodeLine(node)}`)
  if (children.length > MAX_CHILDREN) lines.push(`  … ${children.length - MAX_CHILDREN} more`)
  const reading = snapshot.lens?.trail.at(-1)
  if (snapshot.lens && reading) {
    lines.push(
      '',
      `Call lens: ${snapshot.lens.trail.map((card) => card.node.id).join(' → ')}`,
      `Reading ${reading.node.id}${reading.stale ? ' (file changed since indexed)' : ''}:`,
      ...reading.lines
        .slice(0, MAX_CODE_LINES)
        .map((line, row) => `${reading.startLine + row}  ${line}`),
      ...(reading.lines.length > MAX_CODE_LINES ? ['…'] : []),
    )
  }
  const isLevel = selection?.node.id === view.scope.id || selection?.node.id === reading?.node.id
  if (selection) {
    lines.push('', `${isLevel ? 'This level' : 'Selected'}: ${nodeLine(selection.node)}`)
    for (const [title, relations, direction] of [
      ['Depends on', selection.outgoing, 'out'],
      ['Used by', selection.incoming, 'in'],
    ] as const) {
      if (relations.length === 0) continue
      lines.push(`${title}:`)
      for (const relation of relations.slice(0, MAX_RELATIONS)) {
        lines.push(
          `  ${EDGE_LABEL[relation.kind][direction].toLowerCase()}: ${nodeLine(relation.node)}`,
        )
      }
    }
  }
  return {
    strategy: 'replace',
    bindings: [
      snippetMessageBindingDraft({
        // The chip names where the person is, so a stale context would be visible at a glance;
        // `replace` swaps it on every move and the tab clears it when it is not in view.
        label: `Code graph · ${selection && !isLevel ? selection.node.name : (reading?.node.name ?? view.scope.name)}`,
        language: 'text',
        content: lines.join('\n'),
      }),
    ],
  }
}
