import type { SettingsIndexEntry } from './settingsIndex'
import { rankSearchCandidates } from '@localixai/search'

export interface SettingsSearchResult {
  entry: SettingsIndexEntry
  /** Higher is a better match. */
  score: number
}

/**
 * A parsed query: free-text terms plus `@tab:<id>` filter tokens.
 * Filter tokens narrow the result set; terms rank what remains.
 */
interface ParsedQuery {
  terms: string[]
  tabFilters: string[]
}

const TAB_TOKEN = /^@tab:(.+)$/i

/**
 * Settings copy is prose, and prose is mostly function words. Left in the index they earn
 * relevance they never deserved: the shared ranker treats a suffix difference of up to two
 * characters as a plural-style variant, so the bare "the" in a title or description scores
 * against a query for "theme" — which is how searching "theme" surfaced "Full name". No
 * settings entry is ever *about* a function word, so they are
 * dropped from both the indexed text and the query, leaving ranking to the words that carry
 * the meaning.
 */
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'can',
  'for',
  'from',
  'has',
  'have',
  'in',
  'into',
  'is',
  'it',
  'its',
  'of',
  'or',
  'so',
  'that',
  'the',
  'their',
  'them',
  'then',
  'these',
  'they',
  'this',
  'was',
  'were',
  'when',
  'which',
  'will',
  'with',
  'you',
  'your',
])

const isStopword = (word: string): boolean =>
  STOPWORDS.has(word.replace(/[^a-z]/gi, '').toLowerCase())

/** Drop function words from a field before it is ranked. */
function contentWords(text: string | undefined): string | undefined {
  if (!text) return text
  const kept = text.split(/\s+/).filter((word) => word && !isStopword(word))
  return kept.join(' ')
}

export function parseSettingsQuery(raw: string): ParsedQuery {
  const terms: string[] = []
  const tabFilters: string[] = []
  for (const token of raw.trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    const m = TAB_TOKEN.exec(token)
    if (m) tabFilters.push(m[1])
    else if (!isStopword(token)) terms.push(token)
  }
  return { terms, tabFilters }
}

/**
 * Rank the index against a query. Every free-text term must match (AND
 * semantics) or the entry is dropped, so multi-word queries narrow instead of
 * broadening. `@tab:` tokens restrict to those tabs. An empty query returns [].
 */
export function searchSettings(index: SettingsIndexEntry[], raw: string): SettingsSearchResult[] {
  const { terms, tabFilters } = parseSettingsQuery(raw)
  if (terms.length === 0 && tabFilters.length === 0) return []

  const eligible = index.filter((entry) => {
    if (tabFilters.length) {
      const tabId = String(entry.tab).toLowerCase()
      const tabLabel = entry.tabLabel.toLowerCase()
      const ok = tabFilters.some((f) => tabId === f || tabId.includes(f) || tabLabel.includes(f))
      if (!ok) return false
    }
    return true
  })

  // A pure @tab filter is an exact facet operation, so it preserves index order.
  if (terms.length === 0) {
    return eligible.map((entry) => ({ entry, score: 1 }))
  }

  const query = terms.join(' ')
  return rankSearchCandidates(
    eligible.map((entry) => ({
      item: entry,
      fields: [
        { text: contentWords(entry.title), weight: 1 },
        { text: contentWords(entry.keywords?.join(' ')), weight: 0.72 },
        { text: contentWords(entry.description), weight: 0.5 },
        { text: contentWords(entry.tabLabel), weight: 0.3 },
      ],
    })),
    {
      queries: query,
      scoreOptions: { requireAllTerms: true },
      compare: (left, right) => left.title.localeCompare(right.title),
    },
  ).map(({ item: entry, score }) => ({ entry, score }))
}
