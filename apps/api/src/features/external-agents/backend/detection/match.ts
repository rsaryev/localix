/**
 * Matcher evaluation.
 *
 * The two semantics that are easy to get backwards are called out because inverting either turns
 * a strict blocked-detector into one that fires on ordinary output:
 *
 *   `contains: [a, b]`  → ALL of a and b must be present (conjunction, not disjunction).
 *   `any: [...]`        → at least one nested matcher.
 *   `all: [...]`        → every nested matcher.
 *   `not: [...]`        → none of the nested matchers.
 *   `regex` / `lineRegex` → EVERY listed pattern must match (`lineRegex` per pattern on some
 *                          line, not all on one line).
 *
 * That last one once read "ANY listed pattern matching is enough". It is a conjunction, exactly
 * like `contains` beside it. Nothing misdetected only because every rule happens to carry ONE
 * pattern per array and spells disjunction as an explicit `any: [...]`. It blocked
 * `btw_overlay_working`, whose two patterns are an AND.
 *
 * Comparison is case-insensitive on `contains` because the manifests are written in lowercase
 * and matched against mixed-case TUI output (e.g. `contains = ["do you want to proceed?"]` is
 * expected to match Claude Code's capitalized "Do you want to proceed?").
 */

import type { Matcher } from './manifest-types'
import { translateRustRegex } from './rust-regex'

/**
 * Compiling a pattern on every screen evaluation would recompile the same dozen regexes several
 * times a second while an agent is working. They are immutable manifest data, so cache forever.
 */
const compiled = new Map<string, RegExp | null>()

function compile(pattern: string): RegExp | null {
  const hit = compiled.get(pattern)
  if (hit !== undefined) return hit
  const re = translateRustRegex(pattern)
  compiled.set(pattern, re)
  return re
}

function everyPatternMatches(patterns: readonly string[], text: string): boolean {
  for (const pattern of patterns) {
    const re = compile(pattern)
    // An uncompilable pattern is treated as non-matching rather than as an error: one bad rule in
    // a manifest must never make the whole agent undetectable. Under a conjunction that means the
    // rule cannot fire, which is the safe direction — a state nobody claimed beats a wrong one.
    if (!re?.test(text)) return false
  }
  return true
}

function everyPatternMatchesSomeLine(patterns: readonly string[], text: string): boolean {
  const lines = text.split('\n')
  for (const pattern of patterns) {
    const re = compile(pattern)
    if (!re) return false
    // Each pattern needs SOME line, not the same line.
    if (!lines.some((line) => re.test(line))) return false
  }
  return true
}

export function matches(matcher: Matcher, region: string): boolean {
  const haystack = region.toLowerCase()

  if (matcher.contains && matcher.contains.length > 0) {
    for (const needle of matcher.contains) {
      if (!haystack.includes(needle.toLowerCase())) return false
    }
  }
  if (matcher.regex && matcher.regex.length > 0 && !everyPatternMatches(matcher.regex, region)) {
    return false
  }
  if (
    matcher.lineRegex &&
    matcher.lineRegex.length > 0 &&
    !everyPatternMatchesSomeLine(matcher.lineRegex, region)
  ) {
    return false
  }
  if (matcher.all && matcher.all.length > 0) {
    for (const nested of matcher.all) if (!matches(nested, region)) return false
  }
  if (matcher.any && matcher.any.length > 0) {
    let hit = false
    for (const nested of matcher.any) {
      if (matches(nested, region)) {
        hit = true
        break
      }
    }
    if (!hit) return false
  }
  if (matcher.not && matcher.not.length > 0) {
    for (const nested of matcher.not) if (matches(nested, region)) return false
  }

  // An empty matcher matches nothing. A rule with no conditions would otherwise match every screen
  // at its priority and pin the agent to one state forever.
  return hasAnyCondition(matcher)
}

function hasAnyCondition(matcher: Matcher): boolean {
  return Boolean(
    matcher.contains?.length ||
    matcher.regex?.length ||
    matcher.lineRegex?.length ||
    matcher.any?.length ||
    matcher.all?.length ||
    matcher.not?.length,
  )
}
