/**
 * A flowchart written as Mermaid, read into the board's own model and written back — so the agent
 * writes the diagram in the syntax it knows, a person edits it as text, a pasted `flowchart`
 * becomes one, and the board file stays a diagram anyone can read.
 *
 * Strict where it matters: a line this board cannot draw natively (a click handler, a style) is
 * dropped only when it changes how a diagram LOOKS in Mermaid, never what it SAYS; anything else
 * refuses the text, so a pasted chart is never quietly cut and the full Mermaid element keeps it.
 *
 * A node's class names its role in the diagram (`A:::focal`, `class A,B store`): the board's own
 * vocabulary, written in Mermaid's.
 */
export const FLOW_DIRECTIONS = ['TB', 'LR', 'BT', 'RL'] as const
export const FLOW_SHAPES = [
  'rect',
  'rounded',
  'stadium',
  'subroutine',
  'cylinder',
  'circle',
  'diamond',
  'hexagon',
  'parallelogram',
] as const
export const FLOW_ROLES = ['focal', 'store', 'external', 'optional'] as const
export const FLOW_LINES = ['solid', 'dotted', 'thick'] as const
export const FLOW_HEADS = ['arrow', 'none', 'both'] as const

export type FlowDirection = (typeof FLOW_DIRECTIONS)[number]
export type FlowShape = (typeof FLOW_SHAPES)[number]
export type FlowRole = (typeof FLOW_ROLES)[number]

export interface FlowNode {
  id: string
  label: string
  shape: FlowShape
  role?: FlowRole
  /** The subgraph it is drawn in. */
  group?: string
}
export interface FlowEdge {
  from: string
  to: string
  label: string
  line: (typeof FLOW_LINES)[number]
  head: (typeof FLOW_HEADS)[number]
}
export interface FlowGroup {
  id: string
  label: string
}
export interface FlowContent {
  direction: FlowDirection
  nodes: FlowNode[]
  edges: FlowEdge[]
  groups: FlowGroup[]
}

const HEADER = /^(?:flowchart|graph)(?:\s+(TB|TD|BT|RL|LR))?\s*;?\s*$/iu
/** Lines that style Mermaid's own renderer; the board draws by role instead. */
const COSMETIC = /^(?:classDef|style|linkStyle|click|accTitle|accDescr|direction)\b/u
const ID = /^[A-Za-z0-9_][\w.]*/u

// Opening bracket → its shape and closing bracket; longer openers first.
const BRACKETS: readonly [string, string, FlowShape][] = [
  ['([', '])', 'stadium'],
  ['[[', ']]', 'subroutine'],
  ['[(', ')]', 'cylinder'],
  ['((', '))', 'circle'],
  ['{{', '}}', 'hexagon'],
  ['[/', '/]', 'parallelogram'],
  ['[\\', '\\]', 'parallelogram'],
  ['>', ']', 'rect'],
  ['[', ']', 'rect'],
  ['(', ')', 'rounded'],
  ['{', '}', 'diamond'],
]

const unquote = (text: string) => {
  const trimmed = text.trim()
  const inner = /^"(.*)"$/su.exec(trimmed)?.[1] ?? trimmed
  return inner.replace(/<br\s*\/?>/giu, '\n').replace(/#quot;/gu, '"')
}

const isRole = (name: string): name is FlowRole => (FLOW_ROLES as readonly string[]).includes(name)

interface Cursor {
  text: string
  at: number
}

const skipSpace = (cursor: Cursor) => {
  while (cursor.text[cursor.at] === ' ' || cursor.text[cursor.at] === '\t') cursor.at++
}

/** `id`, `id[label]`, `id:::role`: the node it names, with what it says about it. */
function readNodeRef(cursor: Cursor) {
  skipSpace(cursor)
  const id = ID.exec(cursor.text.slice(cursor.at))?.[0]
  if (!id) return null
  cursor.at += id.length
  let label: string | undefined
  let shape: FlowShape | undefined
  for (const [open, close, kind] of BRACKETS) {
    if (!cursor.text.startsWith(open, cursor.at)) continue
    const quoted = cursor.text[cursor.at + open.length] === '"'
    const from = cursor.at + open.length
    const end = quoted
      ? cursor.text.indexOf(`"${close}`, from + 1) + 1
      : cursor.text.indexOf(close, from)
    if (end <= 0) return null
    label = unquote(cursor.text.slice(from, end))
    shape = kind
    cursor.at = end + close.length
    break
  }
  let role: FlowRole | undefined
  const classed = /^:::([\w-]+)/u.exec(cursor.text.slice(cursor.at))
  if (classed) {
    if (isRole(classed[1]!)) role = classed[1]
    cursor.at += classed[0].length
  }
  return { id, label, shape, role }
}

const LINK_PLAIN = /^(<)?(-{2,}>|-{3,}|-\.+->|-\.+-|={2,}>|={3,}|--[ox])(?:\|("[^"]*"|[^|]*)\|)?/u
const LINK_TEXT = /^(<)?(--|-\.|==)\s+([^-.=|][^|]*?)\s+(-{2,}>|-{3,}|\.+->|\.+-|={2,}>|={3,})/u

/** A link and its label, in either of Mermaid's spellings. */
function readLink(cursor: Cursor): Omit<FlowEdge, 'from' | 'to'> | null {
  skipSpace(cursor)
  const rest = cursor.text.slice(cursor.at)
  const text = LINK_TEXT.exec(rest)
  const plain = text ? null : LINK_PLAIN.exec(rest)
  const match = text ?? plain
  if (!match) return null
  cursor.at += match[0].length
  const arrow = (text ? match[4]! : match[2]!).replace(/^--[ox]$/u, '-->')
  const line = arrow.includes('.') ? 'dotted' : arrow.includes('=') ? 'thick' : 'solid'
  const pointed = arrow.endsWith('>')
  const label = unquote(match[3] ?? '')
  return { line, head: match[1] && pointed ? 'both' : pointed ? 'arrow' : 'none', label }
}

export function readFlow(source: string): FlowContent | string {
  const lines = source
    .replace(/^```\w*\n?|```\s*$/gu, '')
    .split('\n')
    .map((line) => line.replace(/%%.*$/u, '').trim())
  const start = lines.findIndex(Boolean)
  const header = HEADER.exec(lines[start] ?? '')
  if (!header) return 'a flowchart starts with "flowchart TB" (or LR, BT, RL)'
  const raw = (header[1] ?? 'TB').toUpperCase()
  const content: FlowContent = {
    direction: (raw === 'TD' ? 'TB' : raw) as FlowDirection,
    nodes: [],
    edges: [],
    groups: [],
  }
  const nodes = new Map<string, FlowNode>()
  const stack: string[] = []
  const define = (ref: NonNullable<ReturnType<typeof readNodeRef>>) => {
    let node = nodes.get(ref.id)
    if (!node) {
      node = { id: ref.id, label: ref.id, shape: 'rect' }
      if (stack.length) node.group = stack.at(-1)
      nodes.set(ref.id, node)
      content.nodes.push(node)
    }
    if (ref.label !== undefined) node.label = ref.label
    if (ref.shape) node.shape = ref.shape
    if (ref.role) node.role = ref.role
    return node
  }

  for (let index = start + 1; index < lines.length; index++) {
    for (const statement of lines[index]!.includes('"')
      ? [lines[index]!]
      : lines[index]!.split(';')) {
      const line = statement.trim()
      if (!line || COSMETIC.test(line)) continue
      const where = `line ${index + 1}`
      const subgraph = /^subgraph\s+(.+)$/u.exec(line)
      if (subgraph) {
        // One level of areas: a nested one would be flattened, and the paste is meant to be whole.
        if (stack.length) return `${where}: a subgraph inside another is not drawn natively`
        // `subgraph api [API layer]`, `subgraph api`, or a bare title: `subgraph "API layer"`.
        const rest = subgraph[1]!.trim()
        const named = /^([\w.]+)\s*\[(.+)\]$/u.exec(rest) ?? /^([\w.]+)$/u.exec(rest)
        const id = named?.[1] ?? `group${content.groups.length + 1}`
        content.groups.push({ id, label: unquote(named?.[2] ?? (named ? id : rest)) })
        stack.push(id)
        continue
      }
      if (line === 'end') {
        if (!stack.pop()) return `${where}: "end" closes no subgraph`
        continue
      }
      const classes = /^class\s+([\w.,\s]+?)\s+([\w-]+)\s*$/u.exec(line)
      if (classes) {
        const role = classes[2]!
        if (isRole(role))
          for (const id of classes[1]!.split(',').map((part) => part.trim()))
            define({ id, label: undefined, shape: undefined, role })
        continue
      }
      // A chain: `A & B --> C -->|yes| D`.
      const cursor: Cursor = { text: line, at: 0 }
      const readGroup = () => {
        const refs = []
        for (;;) {
          const ref = readNodeRef(cursor)
          if (!ref) return null
          refs.push(define(ref))
          skipSpace(cursor)
          if (cursor.text[cursor.at] !== '&') return refs
          cursor.at++
        }
      }
      let left = readGroup()
      if (!left) return `${where}: "${line}" is not a flowchart statement`
      for (;;) {
        skipSpace(cursor)
        if (cursor.at >= line.length) break
        const link = readLink(cursor)
        const right = link && readGroup()
        if (!link || !right) return `${where}: cannot read "${line.slice(cursor.at)}"`
        for (const from of left)
          for (const to of right) content.edges.push({ from: from.id, to: to.id, ...link })
        left = right
      }
    }
  }
  if (stack.length) return `subgraph "${stack.at(-1)}" has no "end"`
  if (content.nodes.length === 0) return 'the flowchart has no nodes'
  return content
}

export const isFlowText = (text: string) =>
  HEADER.test(
    text
      .replace(/^```\w*\n?/u, '')
      .trimStart()
      .split('\n')[0]
      ?.trim() ?? '',
  )

const OPEN: Record<FlowShape, [string, string]> = {
  rect: ['[', ']'],
  rounded: ['(', ')'],
  stadium: ['([', '])'],
  subroutine: ['[[', ']]'],
  cylinder: ['[(', ')]'],
  circle: ['((', '))'],
  diamond: ['{', '}'],
  hexagon: ['{{', '}}'],
  parallelogram: ['[/', '/]'],
}

const quoteLabel = (label: string) => {
  const text = label.replace(/\n/gu, '<br/>').replace(/"/gu, '#quot;')
  return /^[\w .,:'?!/+-]*$/u.test(text) && text.trim() === text && text ? text : `"${text}"`
}

const ARROW = {
  solid: { arrow: '-->', none: '---' },
  dotted: { arrow: '-.->', none: '-.-' },
  thick: { arrow: '==>', none: '===' },
} as const

export function writeFlow(content: FlowContent): string {
  const lines = [`flowchart ${content.direction}`]
  const node = (item: FlowNode, indent: string) => {
    const [open, close] = OPEN[item.shape]
    const plain = item.shape === 'rect' && item.label === item.id
    lines.push(
      `${indent}${item.id}${plain ? '' : `${open}${quoteLabel(item.label)}${close}`}${item.role ? `:::${item.role}` : ''}`,
    )
  }
  for (const group of content.groups) {
    lines.push(
      `  subgraph ${group.id}${group.label !== group.id ? ` [${quoteLabel(group.label)}]` : ''}`,
    )
    for (const item of content.nodes) if (item.group === group.id) node(item, '    ')
    lines.push('  end')
  }
  for (const item of content.nodes)
    if (!item.group || !content.groups.some((group) => group.id === item.group)) node(item, '  ')
  for (const edge of content.edges) {
    const link = ARROW[edge.line][edge.head === 'none' ? 'none' : 'arrow']
    const label = edge.label ? `|${quoteLabel(edge.label)}|` : ''
    lines.push(`  ${edge.from} ${edge.head === 'both' ? '<' : ''}${link}${label} ${edge.to}`)
  }
  return lines.join('\n')
}
