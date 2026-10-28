import type { ModElement } from '@/shared/api/modsApi'

/**
 * How a pane tab lays out what its mod drew. A mod is written for a terminal, where a pane is a
 * box it must frame and title itself; in Localix the tab already does both. So, from the tree's
 * SHAPE alone, never from which mod drew it:
 *
 * - The tab is the frame. The one root box — or the first framed box inside plain one-child
 *   wrappers — loses its border, padding and margin; its direction, gap and alignment stay. A
 *   frame nested deeper is the mod's own card and is kept.
 * - The tab says the title. A bold first line that repeats the pane's title (glyph, case and
 *   spacing aside) is dropped; one that goes on after the title with a separator (`·`, `-`, `:`)
 *   keeps only what it adds.
 * - The last row of buttons is the pane's action bar. A row (not a column) of Buttons, with
 *   at most text beside them, ends the tree: it is drawn as the bar under the body.
 */

type Node = ModElement | string

export interface PaneLayout {
  nodes: Node[]
  /** The action bar's Buttons and their hint, out of the body; none when the tree has no bar. */
  actions: Node[] | null
}

const isElement = (node: Node): node is ModElement => typeof node !== 'string'
const elements = (nodes: readonly Node[]) =>
  nodes.filter((node) => isElement(node) || node.trim() !== '') as Node[]

const FRAME_PROPS = /^(border|padding|margin)/

const isFramed = (node: ModElement) =>
  node.type === 'Box' && typeof node.props.borderStyle === 'string'
const isPlainWrapper = (node: ModElement) =>
  node.type === 'Box' &&
  node.props.borderStyle === undefined &&
  node.props.backgroundColor === undefined &&
  elements(node.children).length === 1

const unframed = (node: ModElement): ModElement => ({
  ...node,
  props: Object.fromEntries(Object.entries(node.props).filter(([name]) => !FRAME_PROPS.test(name))),
})

/** The tree with its outer frame taken off, and the box that held the pane's rows, if any. */
function withoutFrame(nodes: Node[]): { nodes: Node[]; root: ModElement | null } {
  const [only] = elements(nodes)
  if (elements(nodes).length !== 1 || !only || !isElement(only)) return { nodes, root: null }
  if (isFramed(only)) {
    const root = unframed(only)
    return { nodes: [root], root }
  }
  if (!isPlainWrapper(only)) return { nodes, root: null }
  const inner = withoutFrame(only.children)
  return { nodes: [{ ...only, children: inner.nodes }], root: inner.root }
}

const words = (text: string) =>
  text
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

/** What a bold line adds to the pane's title: nothing (drop it), the rest, or null (keep it). */
function afterTitle(node: Node, title: string): string | null {
  if (!isElement(node) || node.type !== 'Text') return null
  if (node.props.bold !== true && node.props.weight === undefined) return null
  const [line, ...more] = node.children
  if (typeof line !== 'string' || more.length > 0) return null
  const said = words(line)
  const name = words(title)
  if (!name || !said.startsWith(name)) return null
  const rest = said.slice(name.length)
  if (rest === '') return ''
  const separated = /^\s*[·•\-–—:|]\s*/.exec(rest)
  return separated ? line.slice(line.length - rest.length + separated[0].length).trim() : null
}

/** The rows without a first line that repeats the title: alone, or leading a row. */
function withoutTitle(rows: Node[], title: string): Node[] {
  const index = rows.findIndex((row) => isElement(row) || row.trim() !== '')
  const first = rows[index]
  if (!first) return rows
  const replace = (node: Node | null) =>
    [...rows.slice(0, index), ...(node ? [node] : []), ...rows.slice(index + 1)] as Node[]
  const rest = afterTitle(first, title)
  if (rest !== null) return replace(rest ? { ...(first as ModElement), children: [rest] } : null)
  if (!isElement(first) || first.type !== 'Box' || first.props.flexDirection === 'column')
    return rows
  const [lead] = elements(first.children)
  const leadRest = lead ? afterTitle(lead, title) : null
  if (leadRest === null) return rows
  const children = first.children.filter((child) => child !== lead)
  return replace({
    ...first,
    children: leadRest
      ? [{ ...(lead as ModElement), children: [leadRest] }, ...children]
      : children,
  })
}

/** A row of Buttons, with at most text beside them. */
function actionsOf(node: Node | undefined): Node[] | null {
  if (!node || !isElement(node) || node.type !== 'Box') return null
  if (node.props.flexDirection === 'column' || isFramed(node)) return null
  const items = elements(node.children)
  const buttons = items.filter((item) => isElement(item) && item.type === 'Button')
  const allowed = items.every(
    (item) => !isElement(item) || item.type === 'Button' || item.type === 'Text',
  )
  return buttons.length > 0 && allowed ? items : null
}

export function paneLayout(tree: readonly Node[], title: string): PaneLayout {
  const framed = withoutFrame([...tree])
  const root = framed.root
  const column = root?.props.flexDirection === 'column'
  const rows = column ? root.children : framed.nodes
  const titled = withoutTitle(rows, title)
  const last = elements(titled).at(-1)
  const actions = actionsOf(last)
  const body = actions ? titled.filter((row) => row !== last) : titled
  if (!column) return { nodes: body, actions }
  const swap = (nodes: Node[]): Node[] =>
    nodes.map((node) =>
      node === root
        ? { ...root, children: body }
        : isElement(node) && node.type === 'Box'
          ? { ...node, children: swap(node.children) }
          : node,
    )
  return { nodes: swap(framed.nodes), actions }
}
