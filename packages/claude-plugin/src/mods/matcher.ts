/**
 * Which hooks an event reaches: the event name (exact, `ns.*`, or `*`), then the matcher — an
 * object whose fields are compared with the event's. A field matches a value, any value of an
 * array, or a regular expression; a nested object matches the nested fields.
 */
export type MatcherValue = string | number | boolean | RegExp | readonly MatcherValue[] | Matcher
export interface Matcher {
  readonly [field: string]: MatcherValue | undefined
}

/** Telemetry events take their own name and `{ to: 'collector' }`; `*` never matches them. */
const TELEMETRY = /^telemetry\./

export function matchesEventName(pattern: string, event: string): boolean {
  if (pattern === event) return true
  // A negation (`!tool.describe`) selects every event its pattern does not, telemetry aside.
  if (pattern.startsWith('!'))
    return !TELEMETRY.test(event) && !matchesEventName(pattern.slice(1), event)
  if (pattern === '*') return !TELEMETRY.test(event)
  if (pattern.endsWith('.*')) return event.startsWith(pattern.slice(0, -1))
  return false
}

function matchesValue(expected: MatcherValue | undefined, actual: unknown): boolean {
  if (expected === undefined) return true
  if (expected instanceof RegExp) return typeof actual === 'string' && expected.test(actual)
  if (Array.isArray(expected)) return expected.some((option) => matchesValue(option, actual))
  if (typeof expected === 'object')
    return (
      typeof actual === 'object' && actual !== null && matchesFields(expected as Matcher, actual)
    )
  return expected === actual
}

function matchesFields(matcher: Matcher, event: object): boolean {
  const fields = event as Record<string, unknown>
  return Object.entries(matcher).every(([field, expected]) => matchesValue(expected, fields[field]))
}

/** True when every field of `matcher` matches `event` (no matcher matches everything). */
export function matchesEvent(matcher: Matcher | undefined, event: unknown): boolean {
  if (!matcher) return true
  return typeof event === 'object' && event !== null && matchesFields(matcher, event)
}
