import { describe, expect, it } from 'bun:test'
import {
  isCommentLine,
  lineOf,
  personFacingLiterals,
  scanSources,
} from './personFacingLiterals.test-utils'

/**
 * How a failure is WORDED, pinned — in the journal and at the control.
 *
 * Eight ways of saying "that did not work" ("Failed to…", "Couldn't…", "X failed", "The X could not
 * be Y.", a raw git message…) made the same fact look like different facts. The journal was cleaned
 * first, and the same phrases simply survived one call over, in the error line under a form, so
 * this guard reads every place a person reads a failure (`personFacingLiterals.test-utils.ts`):
 *
 * - every failure says what did not happen, actively: "Could not save “a.ts”" — never "Failed to",
 *   "Couldn't", "Unable to" or "Cannot", in any class and in any literal of a UI file;
 * - a journal HEADLINE (`toast.*`, `runMiniAppAction`) is a headline: no trailing full stop, and no
 *   passive "could not be";
 * - an INLINE line (an error under a control, a `ProblemLine` message) is a sentence and ends like
 *   one: a full stop (or "…", "?"). That is what most of them already did, and what
 *   `failure.ts`'s own sentences do; a literal ending in an interpolation is the caller's to word;
 * - a send that did not go through has ONE phrasing per thing sent, the one the transport's own
 *   fallback uses (`operationPhrases.ts`): "Could not send the message" and "Could not send your
 *   answer" — not "this message", "your message", "the answer" or "… to the agent", four ways
 *   that made one failure read as four;
 * - nothing shouts ("!"), and the reason goes in `description`, built with `errorMessage(...)`,
 *   never `String(error)`, which prints `[object Object]` for an API error.
 *
 * It reads string literals only and plants its own positive controls, so a detector that silently
 * stops matching fails here rather than passing.
 */

const OPENER = /^(couldn['’]t|failed to|unable to|cannot)\b/i

const RULES: readonly {
  id: string
  applies: 'headline' | 'inline' | 'any'
  test: (text: string) => boolean
}[] = [
  { id: 'not "Could not …"', applies: 'any', test: (t) => OPENER.test(t.trim()) },
  { id: 'exclamation', applies: 'any', test: (t) => t.trim().endsWith('!') },
  {
    id: 'not the one "Could not send …"',
    applies: 'any',
    test: (t) =>
      /^could not send (this message|your message|the answer)\b|^could not send .+ to the agent\b/i.test(
        t.trim(),
      ),
  },
  { id: 'trailing full stop', applies: 'headline', test: (t) => /[^.]\.$/.test(t.trim()) },
  { id: 'passive "could not be"', applies: 'headline', test: (t) => /\bcould not be\b/i.test(t) },
  {
    id: 'inline sentence without a full stop',
    applies: 'inline',
    test: (t) => !/[.…?}]$/.test(t.trim()),
  },
]

const RAW_REASON = /description:\s*String\(/g
/** A failure opener in ANY literal of a UI file — the shapes above are not the only homes. */
const STRAY_OPENER = /(['"`])((?:Failed to|Couldn['’]t|Unable to)\b(?:\\.|(?!\1)[^\\\n])*)\1/g

export function wordingViolations(source: string, path = '<fixture>', ui = true): string[] {
  const found: string[] = []
  const flagged = new Set<number>()
  for (const literal of personFacingLiterals(source, ui)) {
    if (literal.literalClass === 'body') continue
    for (const rule of RULES) {
      if (rule.applies !== 'any' && rule.applies !== literal.literalClass) continue
      if (!rule.test(literal.text)) continue
      found.push(`${path}:${literal.line} ${rule.id}: ${literal.text}`)
      if (rule.id === 'not "Could not …"') flagged.add(literal.line)
    }
  }
  for (const match of source.matchAll(RAW_REASON)) {
    found.push(`${path}:${lineOf(source, match.index!)} String(error) as the reason`)
  }
  if (ui) {
    for (const match of source.matchAll(STRAY_OPENER)) {
      const line = lineOf(source, match.index!)
      // A comment quoting the old wording is history, not copy.
      if (flagged.has(line) || isCommentLine(source.split('\n')[line - 1] ?? '')) continue
      found.push(`${path}:${line} not "Could not …": ${match[2]}`)
    }
  }
  return found
}

const strip = (lines: string[]) => lines.map((line) => line.split(' ').slice(1).join(' '))

describe('how a failure is worded', () => {
  it('detects every headline rule it claims to enforce (positive control)', () => {
    const fixture = [
      `toast.error('Could not save the file.')`,
      `toast.success("Saved!")`,
      'toast.error(`Failed to load ${name}`)',
      `toast.error("Couldn't rename this conversation")`,
      `toast.error('The update could not be installed')`,
      `toast.error('Could not export', { description: String(error) })`,
      `runMiniAppAction(() => api.fetch(), 'Could not fetch.')`,
      `toast.error('Could not send your answer to the agent')`,
    ].join('\n')
    expect(strip(wordingViolations(fixture))).toEqual([
      'trailing full stop: Could not save the file.',
      'exclamation: Saved!',
      'not "Could not …": Failed to load ${name}',
      `not "Could not …": Couldn't rename this conversation`,
      'passive "could not be": The update could not be installed',
      'trailing full stop: Could not fetch.',
      'not the one "Could not send …": Could not send your answer to the agent',
      'String(error) as the reason',
    ])
    expect(
      wordingViolations(
        [
          `toast.error('Could not save “a.ts”', { description: errorMessage(error, '') })`,
          `toast.info('Indexing…')`,
        ].join('\n'),
      ),
    ).toEqual([])
  })

  it('detects every inline rule, in every place an inline line lives (positive control)', () => {
    const fixture = [
      `setError('Failed to load skills')`,
      `setFormError({ severity: 'error', message: 'Could not save this server' })`,
      `setError(failureSentence(e, 'Unable to reach the cluster.'))`,
      `setError(inlineFailure(e, 'Cannot delete this item.'))`,
      `setError(err instanceof Error ? err.message : 'Could not load “a”')`,
      `toast.problems({ subject, problems: [{ severity: 'error', message: 'The log could not be read' }] })`,
      `const fallback = cause instanceof KubeApiError ? 'x.' : 'Failed to reach the cluster.'`,
      `// setError(errorMessage(e, 'Failed to load files')) used to sit here.`,
      `const reason = e instanceof Error ? e.message : 'could not be read'`,
    ].join('\n')
    expect(strip(wordingViolations(fixture))).toEqual([
      'not "Could not …": Failed to load skills',
      'inline sentence without a full stop: Failed to load skills',
      'inline sentence without a full stop: Could not save this server',
      'not "Could not …": Unable to reach the cluster.',
      'not "Could not …": Cannot delete this item.',
      'inline sentence without a full stop: Could not load “a”',
      'inline sentence without a full stop: The log could not be read',
      'not "Could not …": Failed to reach the cluster.',
    ])
    // The house shapes pass: a sentence, a passive inline sentence, an interpolated ending.
    expect(
      wordingViolations(
        [
          `setError(inlineFailure(e, 'This skill could not be saved.'))`,
          'setError(err instanceof Error ? err.message : `Could not load ${name}`)',
          `setError(null)`,
        ].join('\n'),
      ),
    ).toEqual([])
    // A plugin's backend is not read for inline lines: it speaks to its UI, not to a person.
    expect(wordingViolations(`setError('Failed to load')`, 'x/backend/a.ts', false)).toEqual([])
  })

  it('every literal failure in the host and in plugins follows it', () => {
    expect(scanSources(wordingViolations)).toEqual([])
  })
})
