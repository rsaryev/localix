/**
 * QUERY TEXT INTO AN FTS5 MATCH: the words of a query as terms, and the terms as one OR-query in
 * which every term is quoted, so no FTS5 operator, column filter or stray quote a person typed
 * reaches `MATCH`. Shared by every full-text search over SQLite FTS5 — chat messages and the
 * Store — so they read a query the same way.
 *
 * Words are matched by prefix where a language attaches endings. FTS here has no stemmer for
 * Russian, so a Cyrillic word of five or more letters drops its last letter and matches as a
 * prefix (the plural "retries" then finds its genitive form), and the last word of a query
 * being typed is a prefix too. Words under three letters are dropped in every language: they
 * are mostly function words, and an English stopword list covers the rest of that language.
 */

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'how',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'with',
  'we',
  'i',
  'my',
  'me',
  'you',
])

/** Shorter words are dropped as terms; meaning still sees the whole query. */
const MIN_TERM_LENGTH = 3

export interface QueryTerm {
  /** What a word must equal, or start with when `prefix`. Lowercase, NFKC. */
  stem: string
  prefix: boolean
}

const CYRILLIC = /\p{Script=Cyrillic}/u

export function queryTerms(text: string, options: { prefixLast?: boolean } = {}): QueryTerm[] {
  const seen = new Set<string>()
  const words = text
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((w) => w.length >= MIN_TERM_LENGTH && !STOPWORDS.has(w) && !seen.has(w) && seen.add(w))
  return words.map((word, index) => {
    if (CYRILLIC.test(word) && word.length >= 5) return { stem: word.slice(0, -1), prefix: true }
    const last = options.prefixLast && index === words.length - 1
    return { stem: word, prefix: !!last && word.length >= 2 }
  })
}

/** The terms as an FTS5 OR-query; '' when nothing is searchable. */
export function ftsOrQuery(terms: readonly QueryTerm[]): string {
  return terms.map((t) => `"${t.stem.replace(/"/g, '')}"${t.prefix ? '*' : ''}`).join(' OR ')
}
