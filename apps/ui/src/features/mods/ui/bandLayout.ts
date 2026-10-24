import type { ModElement } from '@/shared/api/modsApi'

/**
 * How the band above the message box lays out what its mods drew. The tree stays the source — every
 * element is still drawn, its Buttons still pressed by key — but the band chooses a compact
 * presentation from the tree's SHAPE alone, never from which mod drew it or what it says:
 *
 * - The band's own wrappers go: a column `Box` with no frame or ground only stacks its children,
 *   and an empty `Box` only spaces them, so the band's own rows and dividers take their place.
 * - `choices`: two or more `plain` Buttons, each alone on its row — a list of things to pick — with
 *   the text-only line just before them as their label, become one row of chips.
 * - `line`: a row of text and controls, one line high, sits with the other lines in one row that
 *   scrolls sideways when it does not fit.
 * - `tree`: anything else (a framed box, a field, code, a picture) is drawn as it is.
 */

export type BandNode = ModElement | string

export type BandBlock =
  | { kind: 'line'; nodes: BandNode[]; summary: string }
  | { kind: 'choices'; label: BandNode[] | null; buttons: ModElement[]; summary: string }
  | { kind: 'tree'; nodes: BandNode[]; summary: string }

/** Elements that never fit one line of the strip. */
const BLOCK_TYPES = new Set(['Code', 'Markdown', 'Input', 'Select', 'Svg', 'Client'])

const isElement = (node: BandNode): node is ModElement => typeof node !== 'string'

const isPlainBox = (node: ModElement) =>
  node.type === 'Box' &&
  node.props.borderStyle === undefined &&
  node.props.backgroundColor === undefined &&
  node.props.display !== 'none'

/** A plain Button, or a bare Box holding only one (a mod indenting its list). */
function plainButtonOf(node: BandNode): ModElement | null {
  if (!isElement(node)) return null
  if (node.type === 'Button') return node.props.plain === true ? node : null
  if (isPlainBox(node) && node.children.length === 1) return plainButtonOf(node.children[0]!)
  return null
}

/** An empty box: it only spaces its neighbours, so the band draws a row boundary instead. */
const SPACER = Symbol('spacer')

/** A box that only stacks its children, or only spaces them: the band's rows replace both. */
function flatten(nodes: readonly BandNode[]): Array<BandNode | typeof SPACER> {
  return nodes.flatMap((node): Array<BandNode | typeof SPACER> => {
    if (!isElement(node) || !isPlainBox(node)) return [node]
    if (node.children.length === 0) return [SPACER]
    if (node.props.flexDirection === 'column' && plainButtonOf(node) === null)
      return flatten(node.children)
    return [node]
  })
}

/** Whether a node draws on one line: text, and rows of text and Buttons. */
function isLine(node: BandNode): boolean {
  if (!isElement(node)) return !node.includes('\n')
  if (BLOCK_TYPES.has(node.type)) return false
  if (node.type === 'Box')
    return (
      node.props.flexDirection !== 'column' &&
      node.props.borderStyle === undefined &&
      node.children.every(isLine)
    )
  return node.children.every(isLine)
}

const hasControls = (node: BandNode): boolean =>
  isElement(node) && (node.type === 'Button' || node.children.some(hasControls))

/** The words a block draws, Buttons' labels too: what the collapsed band shows of it. */
export function summaryOf(nodes: readonly BandNode[]): string {
  const words = (node: BandNode): string =>
    !isElement(node)
      ? node
      : [typeof node.props.label === 'string' ? node.props.label : '', ...node.children.map(words)]
          .filter(Boolean)
          .join(' ')
  return nodes.map(words).join(' ').replace(/\s+/g, ' ').trim()
}

export function bandLayout(tree: readonly BandNode[]): BandBlock[] {
  const blocks: BandBlock[] = []
  let open: Extract<BandBlock, { kind: 'choices' }> | null = null
  for (const item of flatten(tree)) {
    if (item === SPACER) {
      open = null
      continue
    }
    const button = plainButtonOf(item)
    if (button) {
      if (!open) {
        const before = blocks.at(-1)
        const label =
          before?.kind === 'line' && !before.nodes.some(hasControls) ? before.nodes : null
        if (label) blocks.pop()
        open = { kind: 'choices', label, buttons: [], summary: '' }
        blocks.push(open)
      }
      open.buttons.push(button)
      continue
    }
    open = null
    if (typeof item === 'string' && item.trim() === '') continue
    blocks.push({ kind: isLine(item) ? 'line' : 'tree', nodes: [item], summary: '' })
  }
  // A single pick is not a list: it stays a line, with its label beside it.
  return blocks.map((block) => {
    if (block.kind === 'choices' && block.buttons.length < 2) {
      const nodes = [...(block.label ?? []), ...block.buttons]
      return { kind: 'line', nodes, summary: summaryOf(nodes) }
    }
    const nodes =
      block.kind === 'choices' ? [...(block.label ?? []), ...block.buttons] : block.nodes
    return { ...block, summary: summaryOf(nodes) }
  })
}
