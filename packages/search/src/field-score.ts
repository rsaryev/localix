import type { PreparedField, SearchField, ScoreSearchOptions } from './contracts'
import { normalizeSearchText, words } from './normalize'

function compact(value: string): string {
  return value.replace(/ /g, '')
}

/** Quality of an ordered abbreviation inside one word, rewarding tight spans. */
function wordSubsequenceScore(target: string, query: string): number {
  if (query.length < 2 || query.length > target.length) return 0
  let shortest = Number.POSITIVE_INFINITY
  for (
    let start = target.indexOf(query[0]!);
    start >= 0;
    start = target.indexOf(query[0]!, start + 1)
  ) {
    let queryIndex = 1
    let end = start
    while (++end < target.length && queryIndex < query.length) {
      if (target[end] === query[queryIndex]) queryIndex += 1
    }
    if (queryIndex === query.length) shortest = Math.min(shortest, end - start)
  }
  if (!Number.isFinite(shortest)) return 0
  const gaps = shortest - query.length
  if (gaps > Math.max(4, query.length * 2)) return 0
  return Math.max(0.35, 0.62 - gaps * 0.04)
}

/** Inflections the plural rule accepts: plugin→plugins, box→boxes, entry→entries. */
const PLURAL_TAIL = new Set(['s', 'es'])

function wordScore(target: string, query: string): number {
  if (target === query) return 1
  if (query.length >= 2 && target.startsWith(query)) return 0.9
  // Catalog plurals: an indexed "plugin" should answer a query for "plugins".
  // The tail is checked for an actual inflection rather than "any two characters",
  // because the loose form scored the STOPWORD "the" against a query for "theme"
  // at 0.74 — so every entry whose prose contained the word "the" ranked as a
  // theme match. Length alone cannot separate those: "box"→"boxes" is the same
  // shape as "the"→"theme"; only the tail tells them apart.
  if (target.length >= 3 && query.startsWith(target) && PLURAL_TAIL.has(query.slice(target.length)))
    return 0.74
  return wordSubsequenceScore(target, query)
}

function phraseScore(target: string, query: string): number {
  if (!target || !query) return 0
  if (target === query) return 1
  if (target.startsWith(query)) return 0.9
  const at = target.indexOf(query)
  if (at >= 0) return target[at - 1] === ' ' ? 0.8 : 0.6
  const compactQuery = compact(query)
  const compactTarget = compact(target)
  const compactPhrase = words(target).some((term) => term.length > 1)
  if (compactPhrase && compactQuery.length >= 2 && compactTarget === compactQuery) return 0.9
  if (compactPhrase && compactQuery.length >= 2 && compactTarget.startsWith(compactQuery))
    return 0.85
  if (compactPhrase && compactQuery.length >= 3 && compactTarget.includes(compactQuery)) return 0.75
  return wordSubsequenceScore(compactTarget, compactQuery) * 0.82
}

export function prepareFields(fields: readonly SearchField[]): PreparedField[] {
  const present = fields
    .map((field) => ({ text: normalizeSearchText(field.text ?? ''), weight: field.weight ?? 1 }))
    .filter((field) => field.text && Number.isFinite(field.weight) && field.weight > 0)
  const maxWeight = Math.max(1, ...present.map((field) => field.weight))
  return present.map((field) => ({
    text: field.text,
    terms: words(field.text),
    weight: field.weight / maxWeight,
  }))
}

export function adapterFieldScore(
  prepared: readonly PreparedField[],
  needle: string,
  fullText: number,
  options: ScoreSearchOptions,
): number {
  const queryTerms = words(needle)

  let phrase = 0
  for (const field of prepared) {
    phrase = Math.max(phrase, phraseScore(field.text, needle) * field.weight)
  }

  // Compact identifiers and ordered abbreviations intentionally sit outside
  // MiniSearch's word-based model. Keep them as a narrow compatibility adapter.
  let adapterTotal = 0
  let matched = 0
  for (const term of queryTerms) {
    let best = 0
    for (const field of prepared) {
      for (const candidate of field.terms) {
        best = Math.max(best, wordScore(candidate, term) * field.weight)
      }
    }
    if (best > 0) matched += 1
    adapterTotal += best
  }
  const coverage = matched / queryTerms.length
  const adapterScore = (adapterTotal / queryTerms.length) * (0.7 + coverage * 0.3)
  if (options.requireAllTerms && fullText === 0 && coverage < 1) return 0
  let score = Math.max(phrase, fullText, adapterScore)
  // Retain the positional quality of a single-term phrase match: an entire
  // field, its prefix, a word boundary, and a mid-word hit must remain distinct.
  if (queryTerms.length === 1 && phrase > 0) score = Math.min(score, phrase)
  return Math.min(1, score)
}
