import type { ReaderBookSummary, ReaderChapter } from './contracts'

export const READER_SEARCH_MODES = ['contains', 'whole-words', 'nearby-words', 'regex'] as const
export type ReaderSearchMode = (typeof READER_SEARCH_MODES)[number]
export type ReaderSearchScope = 'book' | 'chapter'

export interface ReaderSearchOptions {
  query: string
  scope: ReaderSearchScope
  chapter?: number
  mode: ReaderSearchMode
  matchCase: boolean
  matchDiacritics: boolean
  nearbyWords: number
  limit: number
}

export interface ReaderSearchMatch {
  id: string
  chapter: number
  chapterTitle: string
  before: string
  match: string
  after: string
}

export interface ReaderSearchGroup {
  chapter: number
  chapterTitle: string
  matches: ReaderSearchMatch[]
}

export interface ReaderSearchResponse {
  query: string
  total: number
  truncated: boolean
  groups: ReaderSearchGroup[]
}

export interface ReaderLibrarySearchHit {
  book: ReaderBookSummary
  match: ReaderSearchMatch
}

export interface ReaderLibrarySearchResponse {
  query: string
  total: number
  truncated: boolean
  hits: ReaderLibrarySearchHit[]
}

interface IndexedText {
  value: string
  starts: number[]
  ends: number[]
}

interface Span {
  start: number
  end: number
}

const WORD = /[\p{L}\p{N}_]/u
const MARKS = /\p{M}+/gu
const MAX_SEARCH_TEXT = 2_000_000

function foldUnit(value: string, options: ReaderSearchOptions): string {
  let next = options.matchDiacritics ? value : value.normalize('NFD').replace(MARKS, '')
  if (!options.matchCase) next = next.toLocaleLowerCase()
  return next
}

function indexedText(source: string, options: ReaderSearchOptions): IndexedText {
  const value: string[] = []
  const starts: number[] = []
  const ends: number[] = []
  let pendingWhitespace: { start: number; end: number } | null = null
  for (let offset = 0; offset < source.length;) {
    const point = source.codePointAt(offset)
    if (point === undefined) break
    const unit = String.fromCodePoint(point)
    const end = offset + unit.length
    if (/\s/u.test(unit)) {
      pendingWhitespace ??= { start: offset, end }
      pendingWhitespace.end = end
      offset = end
      continue
    }
    if (pendingWhitespace && value.length > 0) {
      value.push(' ')
      starts.push(pendingWhitespace.start)
      ends.push(pendingWhitespace.end)
    }
    pendingWhitespace = null
    const folded = foldUnit(unit, options)
    for (const character of folded) {
      value.push(character)
      starts.push(offset)
      ends.push(end)
    }
    offset = end
  }
  return { value: value.join(''), starts, ends }
}

function literalSpans(indexed: IndexedText, query: string, wholeWords: boolean): Span[] {
  const spans: Span[] = []
  let cursor = 0
  while (cursor <= indexed.value.length - query.length) {
    const position = indexed.value.indexOf(query, cursor)
    if (position < 0) break
    const end = position + query.length
    const bounded =
      !wholeWords ||
      ((!indexed.value[position - 1] || !WORD.test(indexed.value[position - 1]!)) &&
        (!indexed.value[end] || !WORD.test(indexed.value[end]!)))
    if (bounded) spans.push({ start: position, end })
    cursor = position + Math.max(1, query.length)
  }
  return spans
}

function nearbySpans(indexed: IndexedText, query: string, distance: number): Span[] {
  const terms = [...new Set(query.split(/\s+/u).filter(Boolean))]
  if (terms.length < 2) throw new Error('Nearby search needs at least two words')
  const words = Array.from(indexed.value.matchAll(/[\p{L}\p{N}_]+/gu)).map((match) => ({
    value: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }))
  const spans: Span[] = []
  let lastKey = ''
  for (let start = 0; start < words.length; start += 1) {
    const endLimit = Math.min(words.length, start + Math.max(distance, terms.length))
    const present = new Set<string>()
    let first = Number.POSITIVE_INFINITY
    let last = -1
    for (let cursor = start; cursor < endLimit; cursor += 1) {
      const word = words[cursor]!
      if (!terms.includes(word.value)) continue
      present.add(word.value)
      first = Math.min(first, word.start)
      last = Math.max(last, word.end)
      if (present.size !== terms.length) continue
      const key = `${first}:${last}`
      if (key !== lastKey) spans.push({ start: first, end: last })
      lastKey = key
      break
    }
  }
  return spans
}

function safeRegex(pattern: string): RegExp {
  if (pattern.length > 128) throw new Error('Regular expression is too long')
  if (/\\[1-9]|\(\?[=!<]|\([^)]*[+*][^)]*\)[+*{]|\.\*.*\.\*/u.test(pattern)) {
    throw new Error('Regular expression is too complex')
  }
  try {
    return new RegExp(pattern, 'giu')
  } catch {
    throw new Error('Invalid regular expression')
  }
}

function regexSpans(source: string, pattern: string, matchCase: boolean): Span[] {
  const expression = safeRegex(pattern)
  if (matchCase) {
    expression.compile(expression.source, expression.flags.replace('i', ''))
  }
  const spans: Span[] = []
  for (const match of source.matchAll(expression)) {
    if (!match[0] || match.index === undefined) continue
    spans.push({ start: match.index, end: match.index + match[0].length })
  }
  return spans
}

function compact(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function originalSpan(indexed: IndexedText, span: Span): Span | null {
  const start = indexed.starts[span.start]
  const end = indexed.ends[span.end - 1]
  return start === undefined || end === undefined ? null : { start, end }
}

function excerpt(
  source: string,
  span: Span,
): Pick<ReaderSearchMatch, 'before' | 'match' | 'after'> {
  return {
    before: compact(source.slice(Math.max(0, span.start - 72), span.start)),
    match: compact(source.slice(span.start, span.end)),
    after: compact(source.slice(span.end, Math.min(source.length, span.end + 96))),
  }
}

export const DEFAULT_READER_SEARCH_OPTIONS: Omit<ReaderSearchOptions, 'query'> = {
  scope: 'book',
  mode: 'contains',
  matchCase: false,
  matchDiacritics: false,
  nearbyWords: 10,
  limit: 200,
}

/** Pure, platform-agnostic full-text search over already parsed chapters. */
export function searchReaderChapters(
  chapters: Array<Pick<ReaderChapter, 'index' | 'title' | 'text'>>,
  options: ReaderSearchOptions,
): ReaderSearchResponse {
  const rawQuery = options.query.trim()
  if (!rawQuery) return { query: '', total: 0, truncated: false, groups: [] }
  if (rawQuery.length > 256) throw new Error('Search query is too long')
  const limit = Math.max(1, Math.min(500, options.limit))
  const selected =
    options.scope === 'chapter'
      ? chapters.filter((chapter) => chapter.index === options.chapter)
      : chapters
  const groups: ReaderSearchGroup[] = []
  let total = 0
  let truncated = false

  for (const chapter of selected) {
    const source = chapter.text.slice(0, MAX_SEARCH_TEXT)
    const indexed = indexedText(source, options)
    const foldedQuery = foldUnit(rawQuery.replace(/\s+/gu, ' '), options)
    const indexedSpans =
      options.mode === 'regex'
        ? []
        : options.mode === 'nearby-words'
          ? nearbySpans(indexed, foldedQuery, options.nearbyWords)
          : literalSpans(indexed, foldedQuery, options.mode === 'whole-words')
    const spans =
      options.mode === 'regex'
        ? regexSpans(source, rawQuery, options.matchCase)
        : indexedSpans
            .map((span) => originalSpan(indexed, span))
            .filter((span): span is Span => !!span)
    const matches: ReaderSearchMatch[] = []
    for (const span of spans) {
      if (total >= limit) {
        truncated = true
        break
      }
      const context = excerpt(source, span)
      if (!context.match) continue
      matches.push({
        id: `${chapter.index}:${span.start}:${span.end}`,
        chapter: chapter.index,
        chapterTitle: chapter.title,
        ...context,
      })
      total += 1
    }
    if (matches.length)
      groups.push({ chapter: chapter.index, chapterTitle: chapter.title, matches })
    if (truncated) break
  }
  return { query: rawQuery, total, truncated, groups }
}
