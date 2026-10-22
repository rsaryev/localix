import type { SpaceDocument } from '../format/document'
import type { TypeRegistry } from '../registry/registry'

/**
 * What an element is CALLED wherever the board names one to a person or the agent — a layers row,
 * a search result, a connection in the element's card, a sentence read out by a screen reader.
 *
 * One answer, because four copies had started: the layers panel cut the text at 48 characters and
 * fell back to the type's label, the agent's roster cut it at 100, and a search that matched on
 * one text while a list showed another would find a thing the person could not recognise.
 */

/** The element's whole text, as its type reads it; empty for props it cannot read. */
export function elementText(space: SpaceDocument, registry: TypeRegistry, id: string): string {
  const element = space.elements[id]
  if (!element) return ''
  const spec = registry.get(element.type)
  const read = registry.read(element.type, element.props, space.typeVersions[element.type])
  return spec && read.status === 'ok' ? spec.text(read.props) : ''
}

/** One line, cut to `max` with an ellipsis: whitespace runs are one space. */
export function excerpt(text: string, max: number): string {
  const flat = text.replace(/\s+/gu, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** What a person reads: the type's `summary` when it has one, else its text. */
export function elementSummary(space: SpaceDocument, registry: TypeRegistry, id: string): string {
  const element = space.elements[id]
  if (!element) return ''
  const spec = registry.get(element.type)
  if (!spec?.summary) return elementText(space, registry, id)
  const read = registry.read(element.type, element.props, space.typeVersions[element.type])
  return read.status === 'ok' ? spec.summary(read.props) : ''
}

/** The element's name: its text on one line, or — an empty note — its type's label. */
export function elementName(
  space: SpaceDocument,
  registry: TypeRegistry,
  id: string,
  max = 48,
): string {
  const text = excerpt(elementSummary(space, registry, id), max)
  if (text) return text
  const type = space.elements[id]?.type
  return type ? (registry.get(type)?.label ?? type) : id
}
