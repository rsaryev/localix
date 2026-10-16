import type { NodeKind } from './model'
import type { NodeSummaryView } from './view'

/**
 * Plain-text rendering shared by the agent's tools, the resource the chat attaches and the context
 * the view publishes — one spelling of a node everywhere, so an id the model reads in one place is
 * the id it can pass back in another.
 *
 * Output is budgeted in characters. A tool answer that grows with the project would be fine on a
 * toy repository and flood the context on a real one; past the budget the text stops and says how
 * to narrow the question instead.
 */
export class TextBudget {
  private readonly lines: string[] = []
  private used = 0
  private dropped = 0

  constructor(private readonly limit: number) {}

  /** Adds a line if it fits; returns false once the budget is spent. */
  push(line = ''): boolean {
    if (this.dropped > 0 || this.used + line.length + 1 > this.limit) {
      this.dropped += 1
      return false
    }
    this.lines.push(line)
    this.used += line.length + 1
    return true
  }

  toString(
    hint = 'Narrow the question (a more specific node, a smaller depth) to see the rest.',
  ): string {
    const text = this.lines.join('\n')
    return this.dropped > 0 ? `${text}\n… ${this.dropped} more line(s) omitted. ${hint}` : text
  }
}

const KIND_WORD: Record<NodeKind, string> = {
  directory: 'dir',
  file: 'file',
  class: 'class',
  interface: 'interface',
  type: 'type',
  enum: 'enum',
  function: 'fn',
  method: 'method',
  variable: 'var',
  package: 'package',
}

export function location(node: Pick<NodeSummaryView, 'kind' | 'path' | 'line'>): string {
  if (node.kind === 'package') return 'external'
  if (node.kind === 'directory') return `${node.path || '.'}/`
  return node.line && node.kind !== 'file' ? `${node.path}:${node.line}` : node.path
}

/** `fn helper  sym:src/a.ts#helper  src/a.ts:12  ← 4 · → 2` */
export function nodeLine(node: NodeSummaryView): string {
  const counts =
    node.kind === 'package'
      ? `← ${node.dependents}`
      : `← ${node.dependents} · → ${node.dependencies}`
  return `${KIND_WORD[node.kind]} ${node.name}  ${node.id}  ${location(node)}  ${counts}`
}

export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? word : many}`
}

export function percent(part: number, whole: number): string {
  return whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`
}
