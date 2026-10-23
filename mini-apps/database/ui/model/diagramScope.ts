/**
 * Which tables the relationship diagram may introspect.
 *
 * The defect it stops: opening the diagram asked for the columns of EVERY table in scope. On a
 * 5,000-table warehouse that was 5,000 structure reads queued behind the schema tree, the
 * console's autocomplete and anything the user expanded — minutes of traffic to draw a graph
 * nobody can read at that size anyway. Above {@link DIAGRAM_EAGER_CAP} the diagram therefore
 * reads only what the user narrowed it to: a table-NAME search (column search needs the columns
 * it is trying not to load), a single schema through the existing schema picker, or the direct
 * references of a focused table. With none of those it reads nothing and says why.
 */

/** Largest scope the diagram introspects without being asked to narrow it. */
export const DIAGRAM_EAGER_CAP = 300

/** A name query this short matches most of a big catalogue, so it does not count as narrowing. */
export const DIAGRAM_MIN_QUERY = 2

export interface DiagramObject {
  name: string
  schema?: string
}

export type DiagramLoadPlan =
  /** Small enough to read whole — the behaviour before the gate. */
  | { kind: 'all'; wanted: DiagramObject[] }
  /** Narrowed by a name search and/or a focus; `truncated` when the search still hit the cap. */
  | { kind: 'scoped'; wanted: DiagramObject[]; total: number; truncated: boolean }
  /** Too big and not narrowed: nothing is read until the user picks a scope. */
  | { kind: 'gated'; total: number }

export function diagramLoadPlan(
  objects: readonly DiagramObject[],
  query: string,
  focusRefs: readonly DiagramObject[] = [],
): DiagramLoadPlan {
  if (objects.length <= DIAGRAM_EAGER_CAP) return { kind: 'all', wanted: [...objects] }

  const normalized = query.trim().toLocaleLowerCase()
  const named =
    normalized.length >= DIAGRAM_MIN_QUERY
      ? objects.filter((object) => object.name.toLocaleLowerCase().includes(normalized))
      : []
  if (named.length === 0 && focusRefs.length === 0) return { kind: 'gated', total: objects.length }

  const wanted = [...focusRefs, ...named.slice(0, DIAGRAM_EAGER_CAP)]
  return {
    kind: 'scoped',
    wanted,
    total: objects.length,
    truncated: named.length > DIAGRAM_EAGER_CAP,
  }
}
