/**
 * Plain data, as Claude Code checks it where a hooks module and a surface module meet: a `Client`'s
 * props, a post's data, the props a `ui.message` hook answers. What JSON holds — no function, class
 * instance, `undefined`, non-finite number or cycle — within one tree's bounds.
 */

/** A tree's bounds: values, nesting and characters serialized. */
export const PLAIN_DATA_LIMITS = { values: 20_000, depth: 32, characters: 100_000 } as const

/** Why `value` is not plain data within the bounds, or null when it is. */
export function plainDataProblem(value: unknown): string | null {
  let values = 0
  const visit = (item: unknown, depth: number): string | null => {
    if (++values > PLAIN_DATA_LIMITS.values) return `more than ${PLAIN_DATA_LIMITS.values} values`
    if (depth > PLAIN_DATA_LIMITS.depth) return `nested deeper than ${PLAIN_DATA_LIMITS.depth}`
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return null
    if (typeof item === 'number')
      return Number.isFinite(item) ? null : 'a number that is not finite'
    if (typeof item !== 'object') return `a ${typeof item} is not plain data`
    if (Array.isArray(item)) {
      for (const entry of item) {
        const problem = visit(entry, depth + 1)
        if (problem) return problem
      }
      return null
    }
    const prototype = Object.getPrototypeOf(item) as unknown
    if (prototype !== Object.prototype && prototype !== null) return 'an object that is not plain'
    for (const entry of Object.values(item)) {
      const problem = visit(entry, depth + 1)
      if (problem) return problem
    }
    return null
  }
  const problem = visit(value, 1)
  if (problem) return problem
  return JSON.stringify(value).length > PLAIN_DATA_LIMITS.characters
    ? `more than ${PLAIN_DATA_LIMITS.characters} characters`
    : null
}
