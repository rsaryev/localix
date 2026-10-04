import type { SpaceDocument } from '../format/document'
import { byOrder } from '../format/order'
import type { TypeRegistry } from '../registry/registry'
import { elementText } from './names'

/**
 * Finding an element by what it says: its text, its type, a file's path, its id.
 *
 * The person's search and the agent's `space_read { query }` match by this ONE rule, so "find
 * checkout" finds for one what it finds for the other. Every word must appear somewhere in the
 * element, in any order — "api route" finds `backend/api/routes.ts`. Results rank a match at the
 * start of the text first, then one at the start of a word, then anywhere; ties keep the board's
 * reading order, so the list stays still while the person types.
 */
export interface Found {
  id: string
  /** What matched, on one line: the element's text, or its type's label. */
  text: string
}

/** The query's words, lower-cased; an empty query has none and matches everything. */
export const queryWords = (query: string) => query.toLowerCase().split(/\s+/u).filter(Boolean)

/** Whether the element holds every word of the query. */
export function matchesQuery(
  space: SpaceDocument,
  registry: TypeRegistry,
  id: string,
  words: readonly string[],
): boolean {
  const element = space.elements[id]
  if (!element) return false
  const label = registry.get(element.type)?.label ?? element.type
  const haystack = `${elementText(space, registry, id)} ${label} ${element.type} ${id}`
  const lower = haystack.toLowerCase()
  return words.every((word) => lower.includes(word))
}

export function searchElements(
  space: SpaceDocument,
  registry: TypeRegistry,
  query: string,
  limit = 50,
): Found[] {
  const words = queryWords(query)
  const first = words[0] ?? ''
  const wordStart = new RegExp(`(^|[\\s/._-])${escape(first)}`, 'u')
  return Object.entries(space.elements)
    .map(([id, element]) => ({ id, ...element }))
    .sort((a, b) => a.y - b.y || a.x - b.x || byOrder(a, b))
    .filter((element) => matchesQuery(space, registry, element.id, words))
    .map((element) => {
      const text = elementText(space, registry, element.id).replace(/\s+/gu, ' ').trim()
      const lower = text.toLowerCase()
      const rank = !first || lower.startsWith(first) ? 0 : wordStart.test(lower) ? 1 : 2
      return {
        id: element.id,
        text: text || (registry.get(element.type)?.label ?? element.type),
        rank,
      }
    })
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map(({ id, text }) => ({ id, text }))
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
