import type { ComposeSection } from './compose-types'

/** How many omitted keys the note spells out before it starts counting instead. */
export const NAMED_OMISSIONS = 5

/**
 * What was left out entirely, said once and bounded.
 *
 * Naming every omission looked like the honest choice and broke the ceiling it was added to
 * protect: 30 real keys (`claude-code:cc71d515-…`, 48 characters each) made a 1,898-character note
 * and a 2,869-character answer against a 2,000 budget. A disclosure that overruns the bound is the
 * bug it discloses. Enough keys to act on, then a count.
 */
export function omissionNote(keys: readonly string[], keptSections: number): string {
  const named = keys.slice(0, NAMED_OMISSIONS)
  const rest = keys.length - named.length
  return `${keys.length} session(s) were not included at all: this character budget carries ${keptSections} labelled section(s) before any events are rendered. Ask for fewer sessions, or raise budgetChars. Omitted: ${named.join(
    ', ',
  )}${rest > 0 ? `, and ${rest} more` : ''}.`
}

/** Append the current omission counts to the existing ordering and budget notes. */
export function composeNotes(
  notes: readonly string[],
  omitted: readonly string[],
  sections: readonly ComposeSection[],
  count: number,
  budget: number,
): string[] {
  return [
    ...notes,
    ...(omitted.length > 0 ? [omissionNote(omitted, sections.length)] : []),
    ...(count > 0
      ? [
          `${count} event(s) were withheld to stay within the ${budget.toLocaleString('en-US')}-character budget. Each section reports its own withheld count; request a single session for its full transcript.`,
        ]
      : []),
  ]
}
