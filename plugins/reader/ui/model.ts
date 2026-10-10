import type { ReaderBookSummary, ReaderDailyStat, ReaderSource } from '../shared/contracts'
import { readerExternalLink, readerHasControlCharacters } from '../shared/link'

export interface ReaderPreferences {
  fontSize: number
  fontFamily: ReaderFontFamily
  lineHeight: number
  measure: number
  pageMargin: ReaderPageMargin
  textAlign: ReaderTextAlign
  viewMode: ReaderViewMode
  autoScrollSpeed: number
  speedReadingWpm: number
  highlightColor: ReaderHighlightColor
  focusMode: ReaderFocusMode
}

export type ReaderViewMode = 'scroll' | 'page'
export type ReaderFocusMode = 'off' | 'paragraph' | 'ruler'
export type ReaderFontFamily = 'sans' | 'serif' | 'mono'
export type ReaderPageMargin = 'compact' | 'balanced' | 'roomy'
export type ReaderTextAlign = 'start' | 'justify'
export type ReaderLibrarySort = 'recent' | 'title' | 'progress' | 'format'
export const READER_HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'violet'] as const
export type ReaderHighlightColor = (typeof READER_HIGHLIGHT_COLORS)[number]

export interface ReaderProgress {
  chapter: number
  fraction: number
  chapterCount?: number
}

export interface ReaderNavigationLocation {
  chapter: number
  fraction: number
  fragment?: string
}

export interface ReaderNavigationTrail {
  past: ReaderNavigationLocation[]
  future: ReaderNavigationLocation[]
}

export function emptyReaderNavigationTrail(): ReaderNavigationTrail {
  return { past: [], future: [] }
}

function normalizeReaderNavigationLocation(
  location: ReaderNavigationLocation,
): ReaderNavigationLocation {
  const fragment = location.fragment?.trim().slice(0, 256)
  return {
    chapter: Math.max(0, Math.floor(location.chapter)),
    fraction: Math.max(0, Math.min(1, location.fraction)),
    ...(fragment ? { fragment } : {}),
  }
}

function sameReaderNavigationLocation(
  left: ReaderNavigationLocation,
  right: ReaderNavigationLocation,
) {
  return (
    left.chapter === right.chapter &&
    left.fragment === right.fragment &&
    Math.abs(left.fraction - right.fraction) < 0.001
  )
}

export function pushReaderNavigation(
  trail: ReaderNavigationTrail,
  origin: ReaderNavigationLocation,
  destination: ReaderNavigationLocation,
  limit = 64,
): ReaderNavigationTrail {
  const normalizedOrigin = normalizeReaderNavigationLocation(origin)
  const normalizedDestination = normalizeReaderNavigationLocation(destination)
  if (sameReaderNavigationLocation(normalizedOrigin, normalizedDestination)) return trail
  return {
    past: [...trail.past, normalizedOrigin].slice(-Math.max(1, limit)),
    future: [],
  }
}

export function moveReaderNavigation(
  trail: ReaderNavigationTrail,
  origin: ReaderNavigationLocation,
  direction: 'back' | 'forward',
): { trail: ReaderNavigationTrail; location: ReaderNavigationLocation | null } {
  const normalizedOrigin = normalizeReaderNavigationLocation(origin)
  if (direction === 'back') {
    const location = trail.past.at(-1)
    if (!location) return { trail, location: null }
    return {
      location,
      trail: {
        past: trail.past.slice(0, -1),
        future: [normalizedOrigin, ...trail.future].slice(0, 64),
      },
    }
  }
  const location = trail.future[0]
  if (!location) return { trail, location: null }
  return {
    location,
    trail: {
      past: [...trail.past, normalizedOrigin].slice(-64),
      future: trail.future.slice(1),
    },
  }
}

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

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  fontSize: 18,
  fontFamily: 'sans',
  lineHeight: 1.75,
  measure: 70,
  pageMargin: 'balanced',
  textAlign: 'start',
  viewMode: 'scroll',
  autoScrollSpeed: 28,
  speedReadingWpm: 300,
  highlightColor: 'yellow',
  focusMode: 'off',
}

export function normalizeReaderPreferences(value: unknown): ReaderPreferences {
  const stored = value && typeof value === 'object' ? (value as Partial<ReaderPreferences>) : null
  const fontSize = typeof stored?.fontSize === 'number' ? stored.fontSize : 18
  const lineHeight = typeof stored?.lineHeight === 'number' ? stored.lineHeight : 1.75
  const measure = typeof stored?.measure === 'number' ? stored.measure : 70
  const autoScrollSpeed = typeof stored?.autoScrollSpeed === 'number' ? stored.autoScrollSpeed : 28
  const speedReadingWpm = typeof stored?.speedReadingWpm === 'number' ? stored.speedReadingWpm : 300
  return {
    fontSize: Math.max(14, Math.min(26, Math.round(fontSize))),
    fontFamily:
      stored?.fontFamily === 'serif' || stored?.fontFamily === 'mono' ? stored.fontFamily : 'sans',
    lineHeight: [1.55, 1.75, 1.95].includes(lineHeight) ? lineHeight : 1.75,
    measure: [58, 70, 82].includes(measure) ? measure : 70,
    pageMargin:
      stored?.pageMargin === 'compact' || stored?.pageMargin === 'roomy'
        ? stored.pageMargin
        : 'balanced',
    textAlign: stored?.textAlign === 'justify' ? 'justify' : 'start',
    viewMode: stored?.viewMode === 'page' ? 'page' : 'scroll',
    autoScrollSpeed: Math.max(8, Math.min(72, Math.round(autoScrollSpeed))),
    speedReadingWpm: Math.max(100, Math.min(600, Math.round(speedReadingWpm / 25) * 25)),
    highlightColor: READER_HIGHLIGHT_COLORS.includes(stored?.highlightColor as ReaderHighlightColor)
      ? (stored?.highlightColor as ReaderHighlightColor)
      : 'yellow',
    focusMode:
      stored?.focusMode === 'paragraph' || stored?.focusMode === 'ruler' ? stored.focusMode : 'off',
  }
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

export function sanitizeReaderHtml(source: string): string {
  const document = new DOMParser().parseFromString(source, 'text/html')
  for (const blocked of document.querySelectorAll(
    'script,style,iframe,object,embed,form,input,button,textarea,select,video,audio,canvas,svg,math,link,meta,base',
  )) {
    blocked.remove()
  }
  for (const element of document.body.querySelectorAll('*')) {
    for (const attribute of element.attributes) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim().toLowerCase()
      const safe =
        name === 'alt' ||
        name === 'title' ||
        name === 'lang' ||
        name === 'dir' ||
        name === 'colspan' ||
        name === 'rowspan' ||
        (name === 'id' &&
          attribute.value.length <= 256 &&
          !readerHasControlCharacters(attribute.value)) ||
        (name === 'class' && /^language-[a-z0-9+#.-]{1,32}$/iu.test(attribute.value)) ||
        (name === 'data-reader-chapter' && /^\d{1,3}$/u.test(attribute.value)) ||
        (name === 'data-reader-fragment' &&
          attribute.value.length <= 256 &&
          !readerHasControlCharacters(attribute.value)) ||
        (name === 'data-reader-epub-type' &&
          /^(?:(?:biblio(?:ref|entry)|endnote|footnote|gloss(?:def|ref)|note|noteref|rearnote|backlink)(?:\s+|$)){1,4}$/u.test(
            value,
          )) ||
        (name === 'data-reader-role' &&
          /^(?:(?:definition|doc-(?:biblio(?:ref|entry)|endnote|footnote|glossref|noteref|backlink)|note)(?:\s+|$)){1,4}$/u.test(
            value,
          )) ||
        (name === 'data-reader-callout' &&
          /^(?:caution|important|note|tip|warning)$/u.test(value)) ||
        (name === 'src' && value.startsWith('data:image/')) ||
        (name === 'href' &&
          (value.startsWith('#') || readerExternalLink(attribute.value) !== null)) ||
        (name === 'target' && value === '_blank') ||
        (name === 'rel' && value === 'noreferrer noopener')
      if (!safe) element.removeAttribute(attribute.name)
    }
  }
  return document.body.innerHTML
}

/** Resolve EPUB/MOBI fragments without interpolating them into a CSS selector. */
export function readerFragmentTarget(root: ParentNode, rawFragment: string): HTMLElement | null {
  const fragment = rawFragment.startsWith('#') ? rawFragment.slice(1) : rawFragment
  if (!fragment || fragment.length > 256) return null
  const candidates = new Set([fragment])
  try {
    candidates.add(decodeURIComponent(fragment))
  } catch {
    // Malformed escapes still get an exact-id lookup.
  }
  return (
    Array.from(root.querySelectorAll<HTMLElement>('[id]')).find((element) =>
      candidates.has(element.id),
    ) ?? null
  )
}

export type ReaderNoteKind = 'footnote' | 'endnote' | 'note' | 'definition' | 'reference'

export interface ReaderNotePreview {
  fragment: string
  kind: ReaderNoteKind
  title: string
  html: string
  text: string
}

const READER_NOTE_REFERENCE_TYPES = new Set(['biblioref', 'glossref', 'noteref'])
const READER_NOTE_REFERENCE_ROLES = new Set(['doc-biblioref', 'doc-glossref', 'doc-noteref'])

function readerSemanticTokens(element: Element, attribute: string): Set<string> {
  return new Set(
    (element.getAttribute(attribute) ?? '').trim().toLowerCase().split(/\s+/u).filter(Boolean),
  )
}

function readerNumericMarker(value: string | null | undefined): boolean {
  return value != null && /^.{0,2}\d+$/u.test(value.trim())
}

/** Definite EPUB/DPUB references plus a conservative superscript/numeric fallback. */
export function readerNoteReferenceStrength(
  anchor: HTMLAnchorElement,
): 'definite' | 'possible' | null {
  const types = readerSemanticTokens(anchor, 'data-reader-epub-type')
  const roles = readerSemanticTokens(anchor, 'data-reader-role')
  if (
    [...types].some((token) => READER_NOTE_REFERENCE_TYPES.has(token)) ||
    [...roles].some((token) => READER_NOTE_REFERENCE_ROLES.has(token))
  ) {
    return 'definite'
  }
  const marker =
    Boolean(anchor.parentElement?.closest('sup')) ||
    Boolean(anchor.querySelector('sup')) ||
    readerNumericMarker(anchor.textContent)
  if (!marker) return null
  let container: Element | null = anchor.parentElement
  for (let depth = 0; depth < 3 && container; depth += 1) {
    const numericSiblings = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('a[href]'),
    ).filter(
      (candidate) => candidate !== anchor && readerNumericMarker(candidate.textContent),
    ).length
    if (numericSiblings >= 2) return null
    container = container.parentElement
  }
  return 'possible'
}

function readerNoteKind(element: Element): ReaderNoteKind | null {
  const types = readerSemanticTokens(element, 'data-reader-epub-type')
  const roles = readerSemanticTokens(element, 'data-reader-role')
  if (types.has('footnote') || roles.has('doc-footnote')) return 'footnote'
  if (types.has('endnote') || types.has('rearnote') || roles.has('doc-endnote')) return 'endnote'
  if (types.has('biblioentry') || roles.has('doc-biblioentry') || types.has('biblioref'))
    return 'reference'
  if (types.has('glossdef') || roles.has('definition') || types.has('glossref')) return 'definition'
  if (types.has('note') || roles.has('note') || element.hasAttribute('data-reader-callout'))
    return 'note'
  return null
}

const READER_NOTE_TITLES: Record<ReaderNoteKind, string> = {
  footnote: 'Footnote',
  endnote: 'Endnote',
  note: 'Note',
  definition: 'Definition',
  reference: 'Reference',
}

function readerEscapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** Extract a bounded, sanitized note fragment without mutating the reading document. */
export function readerNotePreview(
  root: HTMLElement,
  fragment: string,
  referenceStrength: 'definite' | 'possible' = 'definite',
): ReaderNotePreview | null {
  if (!fragment || fragment.length > 256) return null
  const target = readerFragmentTarget(root, fragment)
  if (!target) return null
  const semantic = target.closest<HTMLElement>(
    '[data-reader-epub-type],[data-reader-role],[data-reader-callout]',
  )
  const block = semantic ?? target.closest<HTMLElement>('aside,li,dd,dt,blockquote,p,div') ?? target
  const kind = readerNoteKind(block) ?? readerNoteKind(target)
  if (!kind && referenceStrength !== 'definite') return null
  if (!kind && !block.matches('aside,li,dd,dt,blockquote,p')) return null
  const resolvedKind = kind ?? 'note'
  const previewBlock = block.cloneNode(true) as HTMLElement
  const previewHeading = previewBlock.querySelector('h1,h2,h3,h4,h5,h6')
  const heading = previewHeading?.textContent?.replace(/\s+/gu, ' ').trim()
  if (heading) previewHeading?.remove()
  const text = (previewBlock.textContent ?? '').replace(/\s+/gu, ' ').trim().slice(0, 8_000)
  if (!text) return null
  const sanitized = sanitizeReaderHtml(previewBlock.innerHTML)
  const html =
    sanitized.length <= 16_000
      ? sanitized
      : `<p>${readerEscapeHtml(text)}${text.length >= 8_000 ? '…' : ''}</p>`
  return {
    fragment,
    kind: resolvedKind,
    title: heading || READER_NOTE_TITLES[resolvedKind],
    html,
    text,
  }
}
