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
export const READER_HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'violet'] as const
export type ReaderHighlightColor = (typeof READER_HIGHLIGHT_COLORS)[number]

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
