import type { ReaderBookSummary, ReaderDailyStat, ReaderSource } from '../shared/contracts'

import { READER_HIGHLIGHT_COLORS, type ReaderHighlightColor } from './reader-preferences'
export {
  READER_HIGHLIGHT_COLORS,
  DEFAULT_READER_PREFERENCES,
  normalizeReaderPreferences,
} from './reader-preferences'
export type {
  ReaderPreferences,
  ReaderViewMode,
  ReaderFocusMode,
  ReaderFontFamily,
  ReaderPageMargin,
  ReaderTextAlign,
  ReaderHighlightColor,
} from './reader-preferences'

export type ReaderLibrarySort = 'recent' | 'title' | 'progress' | 'format'

export interface ReaderProgress {
  chapter: number
  fraction: number
  chapterCount?: number
}

export {
  emptyReaderNavigationTrail,
  pushReaderNavigation,
  moveReaderNavigation,
} from './reader-navigation'
export type { ReaderNavigationLocation, ReaderNavigationTrail } from './reader-navigation'

export interface ReaderSpeedToken {
  text: string
  focusIndex: number
  pauseFactor: number
}

export interface ReaderSavedQuote {
  id: string
  source?: ReaderSource
  path: string
  bookTitle?: string
  chapter: number
  chapterTitle: string
  quote: string
  target?: ReaderTextTarget
  color?: ReaderHighlightColor
  note?: string
  createdAt: string
  updatedAt?: string
}

export interface ReaderBookmark {
  id: string
  source: ReaderSource
  path: string
  bookTitle: string
  chapter: number
  chapterTitle: string
  createdAt: string
}

const READER_WORKSPACE_SELECTION_KEY = 'reader:workspace-selection:v1'

/** A library work item is restorable, so its selected book must not live only in
 * React state. Scope the selection to the owning session; explicit book/file
 * work items already carry their source in their own payload. */
export function readerWorkspaceSelectionKey(sessionId: string): string {
  return `${READER_WORKSPACE_SELECTION_KEY}:${encodeURIComponent(sessionId || '@global')}`
}

/** Accept only the small, durable ReaderSource contract from browser storage. */
export function normalizeReaderWorkspaceSource(value: unknown): ReaderSource | null {
  if (!value || typeof value !== 'object') return null
  const stored = value as { path?: unknown; mediaId?: unknown; name?: unknown }
  if (typeof stored.path === 'string' && stored.path.trim()) {
    return { path: stored.path }
  }
  if (typeof stored.mediaId === 'string' && stored.mediaId.trim()) {
    return {
      mediaId: stored.mediaId,
      ...(typeof stored.name === 'string' && stored.name.trim() ? { name: stored.name } : {}),
    }
  }
  return null
}

export function readerAutoScrollDistance(speed: number, elapsedMs: number): number {
  const safeSpeed = Math.max(8, Math.min(72, Number.isFinite(speed) ? speed : 28))
  const safeElapsed = Math.max(0, Math.min(100, Number.isFinite(elapsedMs) ? elapsedMs : 0))
  return (safeSpeed * safeElapsed) / 1_000
}

export function readerSpeedFocusIndex(value: string): number {
  const length = Array.from(value.replace(/[^\p{L}\p{N}]/gu, '')).length
  const target = length <= 1 ? 0 : length <= 5 ? 1 : length <= 9 ? 2 : 3
  return Math.max(0, Math.min(Array.from(value).length - 1, target))
}

/** Tokenize chapter text for a local RSVP presentation without sending content anywhere. */
export function readerSpeedTokens(value: string): ReaderSpeedToken[] {
  const raw = value.match(/[\p{L}\p{N}\p{M}'’-]+(?:[.,!?…。，！？；：,;:])?|[^\s]/gu) ?? []
  const tokens = raw.flatMap((token) =>
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(token)
      ? Array.from(token)
      : [token],
  )
  return tokens.slice(0, 250_000).map((text) => ({
    text,
    focusIndex: readerSpeedFocusIndex(text),
    pauseFactor: /[.!?…。！？]$/u.test(text)
      ? 2.2
      : /[,;:，；：]$/u.test(text)
        ? 1.45
        : Array.from(text).length >= 12
          ? 1.2
          : 1,
  }))
}

export function readerSpeedStartIndex(tokenCount: number, fraction: number): number {
  if (tokenCount <= 0) return 0
  return Math.max(0, Math.min(tokenCount - 1, Math.round((tokenCount - 1) * fraction)))
}

export function readerNearestFocusBlock(
  rects: readonly { top: number; bottom: number }[],
  viewportTop: number,
  viewportBottom: number,
): number {
  if (!rects.length) return -1
  const center = (viewportTop + viewportBottom) / 2
  let bestIndex = 0
  let bestScore = Number.POSITIVE_INFINITY
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects[index]!
    const visible = rect.bottom > viewportTop && rect.top < viewportBottom
    const distance = Math.abs((rect.top + rect.bottom) / 2 - center)
    const score = distance + (visible ? 0 : Math.abs(viewportBottom - viewportTop) * 2)
    if (score < bestScore) {
      bestIndex = index
      bestScore = score
    }
  }
  return bestIndex
}

export function readerProgressPercent(
  chapter: number,
  chapterCount: number,
  fraction: number,
): number {
  if (chapterCount <= 0) return 0
  const value = ((chapter + Math.max(0, Math.min(1, fraction))) / chapterCount) * 100
  return Math.max(0, Math.min(100, value))
}

export function readerActivityWindow(
  activity: readonly ReaderDailyStat[],
  today: string,
  days = 14,
): ReaderDailyStat[] {
  const totals = new Map(activity.map((item) => [item.date, item.readMs]))
  const end = new Date(`${today}T00:00:00.000Z`)
  if (!Number.isFinite(end.getTime())) return []
  return Array.from({ length: Math.max(1, Math.min(31, Math.round(days))) }, (_, index) => {
    const date = new Date(end)
    date.setUTCDate(end.getUTCDate() - (days - index - 1))
    const key = date.toISOString().slice(0, 10)
    return { date: key, readMs: totals.get(key) ?? 0 }
  })
}

export function sortReaderBooks(
  books: readonly ReaderBookSummary[],
  sort: ReaderLibrarySort,
  progressFor: (book: ReaderBookSummary) => number = () => 0,
): ReaderBookSummary[] {
  const titleOrder = (left: ReaderBookSummary, right: ReaderBookSummary) =>
    left.title.localeCompare(right.title, undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  return [...books].sort((left, right) => {
    if (sort === 'title') return titleOrder(left, right)
    if (sort === 'progress')
      return progressFor(right) - progressFor(left) || titleOrder(left, right)
    if (sort === 'format') return left.format.localeCompare(right.format) || titleOrder(left, right)
    return right.updatedAt.localeCompare(left.updatedAt) || titleOrder(left, right)
  })
}

export function readerPassageAtFraction(
  sourceValue: string,
  fractionValue: number,
  maxCharacters = 6_000,
): string {
  const source = normalizeReaderText(sourceValue)
  if (source.length <= maxCharacters) return source
  const fraction = Math.max(0, Math.min(1, fractionValue))
  const start = Math.round((source.length - maxCharacters) * fraction)
  const raw = source.slice(start, start + maxCharacters)
  const left = start > 0 ? raw.indexOf(' ') + 1 : 0
  const right = start + maxCharacters < source.length ? raw.lastIndexOf(' ') : raw.length
  return raw.slice(left, right > left ? right : raw.length).trim()
}

export function readerVisiblePassage(
  root: HTMLElement,
  viewport: HTMLElement,
  fallbackText: string,
  fraction: number,
  maxCharacters = 6_000,
): string {
  const viewportRect = viewport.getBoundingClientRect()
  const selector = 'h1,h2,h3,h4,p,li,blockquote,pre,figcaption,td,th'
  const visible: string[] = []
  for (const block of root.querySelectorAll<HTMLElement>(selector)) {
    if (block.querySelector(selector)) continue
    const intersects = Array.from(block.getClientRects()).some(
      (rect) =>
        rect.bottom > viewportRect.top &&
        rect.top < viewportRect.bottom &&
        rect.right > viewportRect.left &&
        rect.left < viewportRect.right,
    )
    if (!intersects) continue
    const text = normalizeReaderText(block.textContent ?? '')
    if (text) visible.push(text)
  }
  const passage = normalizeReaderText(visible.join('\n'))
  if (!passage) return readerPassageAtFraction(fallbackText, fraction, maxCharacters)
  if (passage.length <= maxCharacters) return passage
  return readerPassageAtFraction(passage, 0, maxCharacters)
}

export interface ReaderTextRange {
  block: HTMLElement
  segments: Array<{ node: Text; start: number; end: number }>
}

export interface ReaderTextTarget {
  quote: string
  before?: string
  after?: string
}

export function normalizeReaderText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

export function readerTextTargetKey(target: ReaderTextTarget): string {
  return [
    normalizeReaderText(target.quote),
    normalizeReaderText(target.before ?? ''),
    normalizeReaderText(target.after ?? ''),
  ].join('\u001f')
}

export function normalizeReaderSavedQuote(item: ReaderSavedQuote): ReaderSavedQuote {
  return {
    ...item,
    target: item.target ?? { quote: item.quote },
    color: READER_HIGHLIGHT_COLORS.includes(item.color as ReaderHighlightColor)
      ? (item.color as ReaderHighlightColor)
      : 'yellow',
    note: item.note ?? '',
    updatedAt: item.updatedAt ?? item.createdAt,
  }
}

export function upsertReaderSavedQuote(
  items: ReaderSavedQuote[],
  input: ReaderSavedQuote,
  updatedAt = new Date().toISOString(),
): { items: ReaderSavedQuote[]; id: string } {
  const quote = normalizeReaderSavedQuote(input)
  const duplicate = items.find(
    (item) =>
      item.path === quote.path &&
      item.chapter === quote.chapter &&
      readerTextTargetKey(item.target ?? { quote: item.quote }) ===
        readerTextTargetKey(quote.target ?? { quote: quote.quote }),
  )
  if (!duplicate) {
    let id = quote.id
    for (let suffix = 2; items.some((item) => item.id === id); suffix += 1) {
      id = `${quote.id}-${suffix}`
    }
    const inserted = id === quote.id ? quote : { ...quote, id }
    return { items: [inserted, ...items].slice(0, 500), id }
  }
  return {
    id: duplicate.id,
    items: items.map((item) =>
      item.id === duplicate.id
        ? {
            ...item,
            ...quote,
            id: duplicate.id,
            createdAt: duplicate.createdAt,
            updatedAt,
          }
        : item,
    ),
  }
}

/**
 * Annotation targets are persisted as text. Anything else in an imported document is
 * corrupt input, not a value to stringify — coercing an object here used to write the
 * literal `[object Object]` into the quote and let the annotation through.
 */
function readerTargetText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function parseReaderAnnotationExport(value: unknown): ReaderSavedQuote[] {
  if (!value || typeof value !== 'object') throw new TypeError('Invalid annotation document')
  const document = value as Record<string, unknown>
  if (document.schema !== 'localix.reader.annotations' || document.version !== 1) {
    throw new TypeError('Unsupported annotation document')
  }
  if (!Array.isArray(document.annotations)) throw new TypeError('Annotations must be an array')
  return document.annotations.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new TypeError(`Invalid annotation ${index + 1}`)
    const item = entry as Record<string, unknown>
    if (
      typeof item.id !== 'string' ||
      !item.id ||
      typeof item.path !== 'string' ||
      !item.path ||
      typeof item.chapter !== 'number' ||
      !Number.isSafeInteger(item.chapter) ||
      item.chapter < 0 ||
      typeof item.chapterTitle !== 'string' ||
      typeof item.quote !== 'string' ||
      !normalizeReaderText(item.quote) ||
      typeof item.createdAt !== 'string'
    ) {
      throw new TypeError(`Invalid annotation ${index + 1}`)
    }
    const targetValue = item.target
    const target =
      targetValue && typeof targetValue === 'object'
        ? {
            quote: readerTargetText((targetValue as Record<string, unknown>).quote),
            ...((targetValue as Record<string, unknown>).before === undefined
              ? {}
              : {
                  before: readerTargetText((targetValue as Record<string, unknown>).before),
                }),
            ...((targetValue as Record<string, unknown>).after === undefined
              ? {}
              : {
                  after: readerTargetText((targetValue as Record<string, unknown>).after),
                }),
          }
        : { quote: item.quote }
    if (!normalizeReaderText(target.quote)) throw new TypeError(`Invalid annotation ${index + 1}`)
    return normalizeReaderSavedQuote({
      id: item.id.slice(0, 256),
      path: item.path.slice(0, 4_096),
      bookTitle: typeof item.bookTitle === 'string' ? item.bookTitle.slice(0, 1_024) : undefined,
      chapter: item.chapter,
      chapterTitle: item.chapterTitle.slice(0, 1_024),
      quote: normalizeReaderText(item.quote).slice(0, 8_000),
      target: {
        quote: normalizeReaderText(target.quote).slice(0, 8_000),
        ...(target.before ? { before: normalizeReaderText(target.before).slice(-256) } : {}),
        ...(target.after ? { after: normalizeReaderText(target.after).slice(0, 256) } : {}),
      },
      color: READER_HIGHLIGHT_COLORS.includes(item.color as ReaderHighlightColor)
        ? (item.color as ReaderHighlightColor)
        : 'yellow',
      note: typeof item.note === 'string' ? item.note.slice(0, 32_000) : '',
      createdAt: item.createdAt,
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : item.createdAt,
    })
  })
}

export function readerTextTargetAt(
  sourceValue: string,
  quoteValue: string,
  approximateStart: number,
  contextLength = 96,
): ReaderTextTarget | null {
  const source = normalizeReaderText(sourceValue)
  const quote = normalizeReaderText(quoteValue).slice(0, 8_000)
  if (!source || !quote) return null
  let best = -1
  let distance = Number.POSITIVE_INFINITY
  for (let start = source.indexOf(quote); start >= 0; start = source.indexOf(quote, start + 1)) {
    const nextDistance = Math.abs(start - approximateStart)
    if (nextDistance < distance) {
      best = start
      distance = nextDistance
    }
  }
  if (best < 0) return { quote }
  const before = source.slice(Math.max(0, best - contextLength), best).trim()
  const after = source.slice(best + quote.length, best + quote.length + contextLength).trim()
  return {
    quote,
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
  }
}

export function selectionTargetWithin(
  root: HTMLElement | null,
  selection: Selection | null,
): ReaderTextTarget | null {
  if (!root || !selection || selection.isCollapsed || selection.rangeCount < 1) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null
  const prefixRange = document.createRange()
  prefixRange.selectNodeContents(root)
  try {
    prefixRange.setEnd(range.startContainer, range.startOffset)
  } catch {
    return null
  }
  return readerTextTargetAt(
    root.textContent ?? '',
    selection.toString(),
    normalizeReaderText(prefixRange.toString()).length,
  )
}

export function findReaderTextIndex(source: string, targetValue: ReaderTextTarget): number {
  const target = normalizeReaderText(targetValue.quote)
  if (!target) return -1
  const before = normalizeReaderText(targetValue.before ?? '')
  const after = normalizeReaderText(targetValue.after ?? '')
  let start = source.indexOf(target)
  while (
    start >= 0 &&
    ((before && !source.slice(0, start).trimEnd().endsWith(before)) ||
      (after &&
        !source
          .slice(start + target.length)
          .trimStart()
          .startsWith(after)))
  ) {
    start = source.indexOf(target, start + Math.max(1, target.length))
  }
  return start
}

/** Locate a saved, whitespace-normalized quote in rendered book markup. */
export function findReaderTextRange(
  root: HTMLElement,
  targetInput: string | ReaderTextTarget,
): ReaderTextRange | null {
  const targetValue = typeof targetInput === 'string' ? { quote: targetInput } : targetInput
  const target = targetValue.quote.replace(/\s+/g, ' ').trim()
  if (!target) return null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const normalized: string[] = []
  const positions: Array<{ node: Text; offset: number }> = []
  let pendingSpace: { node: Text; offset: number } | null = null
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    const node = current as Text
    for (let offset = 0; offset < node.data.length; offset += 1) {
      const character = node.data[offset]!
      if (/\s/u.test(character)) {
        pendingSpace ??= { node, offset }
        continue
      }
      if (pendingSpace && normalized.length > 0) {
        normalized.push(' ')
        positions.push(pendingSpace)
      }
      pendingSpace = null
      normalized.push(character)
      positions.push({ node, offset })
    }
  }
  const source = normalized.join('')
  const start = findReaderTextIndex(source, targetValue)
  if (start < 0) return null
  const first = positions[start]
  const last = positions[start + target.length - 1]
  if (!first || !last) return null
  const segments: ReaderTextRange['segments'] = []
  for (const position of positions.slice(start, start + target.length)) {
    const previous = segments.at(-1)
    if (previous?.node === position.node) {
      previous.end = position.offset + 1
    } else {
      segments.push({
        node: position.node,
        start: position.offset,
        end: position.offset + 1,
      })
    }
  }
  const block =
    first.node.parentElement?.closest<HTMLElement>('p,li,blockquote,pre,td,th,h1,h2,h3,h4,div') ??
    root
  return { block, segments }
}

export { sanitizeReaderHtml, readerFragmentTarget } from './reader-html'
export { readerNoteReferenceStrength, readerNotePreview } from './reader-notes'
export type { ReaderNoteKind, ReaderNotePreview } from './reader-notes'
