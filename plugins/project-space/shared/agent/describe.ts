import type { SpaceDocument, SpaceIssue } from '../format/document'
import { byOrder } from '../format/order'
import { frameOf, membersOf } from '../ops/geometry'
import { groupsOf } from '../ops/groups'
import type { TypeRegistry } from '../registry/registry'
import { arrowOf } from '../graph/links'
import { elementText, excerpt as cut } from '../graph/names'
import { matchesQuery, queryWords } from '../graph/search'

/**
 * The board as the agent reads it: a ROSTER, not the file.
 *
 * Each element is one line — its id, type, where it is, the frame it sits in, its groups
 * (innermost first, `group inner<outer`: the ids `order`, `align` and `ungroup` take), whether it
 * is locked or faded, a short excerpt of its text — and each connector one arrow. Lines run
 * bottom to top, the stacking order. Broad reads use excerpts; explicit ids include validated
 * props and full native content. A file element names its path and the agent reads the file with
 * its own tools (the context carries names and summaries,
 * then the model reads what it needs). That keeps a large board inside the budget and keeps the
 * tool from duplicating the file tools. A board larger than `limit` is summarized by frame, and
 * the agent narrows with `frame`, `ids` or `query`.
 */
export interface DescribeOptions {
  ids?: readonly string[]
  frame?: string
  query?: string
  limit?: number
  /** Elements whose referenced path no longer exists, found by the caller on disk. */
  missing?: ReadonlySet<string>
  issues?: readonly SpaceIssue[]
}

const EXCERPT = 100

export function describeSpace(
  space: SpaceDocument,
  registry: TypeRegistry,
  options: DescribeOptions = {},
): string {
  const all = Object.entries(space.elements)
    .map(([id, element]) => ({ id, ...element }))
    .sort(byOrder)
  const edges = Object.entries(space.edges)
  const lines = [
    `Project Space: ${all.length} element${all.length === 1 ? '' : 's'}, ${edges.length} connector${edges.length === 1 ? '' : 's'}. Coordinates are board pixels; x grows right, y down. Listed bottom to top.`,
  ]
  if (all.length === 0) {
    lines.push('The board is empty.')
    return lines.join('\n')
  }

  // The person's search on the board matches by the same rule (`graph/search.ts`).
  const words = queryWords(options.query ?? '')
  const textOf = (element: (typeof all)[number]) => elementText(space, registry, element.id)
  const inFrame = options.frame ? new Set(membersOf(space, options.frame, registry)) : undefined
  const selected = all.filter(
    (element) =>
      (!options.ids || options.ids.includes(element.id)) &&
      (!inFrame || inFrame.has(element.id)) &&
      matchesQuery(space, registry, element.id, words),
  )
  const limit = options.limit ?? 150
  const live = groupsOf(space)

  if (selected.length > limit) {
    lines.push(
      `${selected.length} elements match — more than ${limit}. Frames, with what each holds; read one with "frame":`,
    )
    for (const element of all)
      if (registry.get(element.type)?.container)
        lines.push(
          `  [${element.id}] ${element.type} "${excerpt(textOf(element))}" — ${membersOf(space, element.id, registry).length} elements`,
        )
    return lines.join('\n')
  }

  for (const element of selected) {
    const frame = frameOf(space, element.id, registry)
    const where = `(${Math.round(element.x)},${Math.round(element.y)} ${Math.round(element.w)}×${Math.round(element.h)})`
    const read = registry.read(element.type, element.props, space.typeVersions[element.type])
    const state =
      read.status === 'ok'
        ? ''
        : read.status === 'unknown'
          ? ' — unknown type, kept as it is'
          : read.status === 'newer'
            ? ' — from a newer build, read-only'
            : ` — invalid props: ${read.message}`
    const text = excerpt(textOf(element))
    const groups = (element.groups ?? []).filter((group) => live.has(group))
    const marks = [
      frame ? `in ${frame}` : '',
      groups.length ? `group ${groups.join('<')}` : '',
      element.locked ? 'locked' : '',
      element.opacity !== undefined ? `opacity ${element.opacity}` : '',
    ].filter(Boolean)
    lines.push(
      `[${element.id}] ${element.type} ${where}${marks.length ? ` ${marks.join(' ')}` : ''}${text ? `: ${text}` : ''}${options.missing?.has(element.id) ? ' — MISSING on disk' : ''}${state}`,
    )
    if (options.ids && read.status === 'ok') {
      const props = { ...read.props }
      // Source-bearing diagrams are printed below as readable source, without duplicating it.
      if (
        (element.type === 'image' || element.type === 'mermaid') &&
        typeof props.source === 'string'
      )
        delete props.source
      lines.push(`Props [${element.id}]: ${JSON.stringify(props)}`)
    }
    // Imported pictures preserve definitions that a vector preview cannot reveal. Keep broad
    // reads compact, but an explicit id must let the agent inspect the exact original source.
    if (
      read.status === 'ok' &&
      (element.type === 'image' || element.type === 'mermaid') &&
      typeof element.props.source === 'string'
    ) {
      const format =
        typeof element.props.sourceFormat === 'string'
          ? element.props.sourceFormat
          : element.type === 'mermaid'
            ? 'mermaid'
            : 'text'
      lines.push(
        options.ids
          ? `Source [${element.id}] (${format}):\n${element.props.source}`
          : `  ${format} source available — read with ids: ["${element.id}"]`,
      )
    }
  }
  const shown = new Set(selected.map((element) => element.id))
  const arrows = edges.filter(([, edge]) => shown.has(edge.from) || shown.has(edge.to))
  if (arrows.length) lines.push('Connectors:')
  for (const [id, edge] of arrows) {
    // The person's trace follows the same arrow (`graph/links.ts`).
    const glyph = arrowOf(edge)
    const style = [edge.route, edge.stroke].filter(
      (part) => part && part !== 'curved' && part !== 'solid',
    )
    lines.push(
      `[${id}] ${edge.from} ${glyph} ${edge.to}${edge.label ? ` "${excerpt(edge.label)}"` : ''}${style.length ? ` (${style.join(', ')})` : ''}`,
    )
  }
  if (options.issues?.length) {
    lines.push('File problems (kept in the file, fix them in place):')
    for (const issue of options.issues.slice(0, 20))
      lines.push(`  ${issue.path || 'file'}: ${issue.message}`)
  }
  return lines.join('\n')
}

const excerpt = (text: string) => cut(text, EXCERPT)
