import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_READER_PREFERENCES,
  emptyReaderNavigationTrail,
  findReaderTextIndex,
  normalizeReaderPreferences,
  normalizeReaderWorkspaceSource,
  parseReaderAnnotationExport,
  readerActivityWindow,
  readerAutoScrollDistance,
  readerNearestFocusBlock,
  moveReaderNavigation,
  pushReaderNavigation,
  readerPassageAtFraction,
  readerProgressPercent,
  readerWorkspaceSelectionKey,
  readerSpeedStartIndex,
  readerSpeedTokens,
  readerTextTargetAt,
  readerTextTargetKey,
  sortReaderBooks,
  upsertReaderSavedQuote,
} from './model'

describe('reader presentation model', () => {
  test('restores only valid session-scoped workspace book selections', () => {
    expect(readerWorkspaceSelectionKey('session/one')).toBe(
      'reader:workspace-selection:v1:session%2Fone',
    )
    expect(readerWorkspaceSelectionKey('')).toBe('reader:workspace-selection:v1:%40global')
    expect(normalizeReaderWorkspaceSource({ path: '/books/guide.epub' })).toEqual({
      path: '/books/guide.epub',
    })
    expect(
      normalizeReaderWorkspaceSource({ mediaId: 'upload-1', name: 'Guide.epub', path: 42 }),
    ).toEqual({ mediaId: 'upload-1', name: 'Guide.epub' })
    expect(normalizeReaderWorkspaceSource({ path: '  ', mediaId: '' })).toBeNull()
    expect(normalizeReaderWorkspaceSource('not-a-source')).toBeNull()
  })

  test('maps chapter-local progress onto the whole book', () => {
    expect(readerProgressPercent(1, 4, 0.5)).toBe(37.5)
    expect(readerProgressPercent(3, 4, 1)).toBe(100)
  })

  test('keeps bounded browser-style history for exact reading locations', () => {
    const first = pushReaderNavigation(
      emptyReaderNavigationTrail(),
      { chapter: 4, fraction: 0.42 },
      { chapter: 8, fraction: 0, fragment: 'target' },
    )
    expect(first).toEqual({
      past: [{ chapter: 4, fraction: 0.42 }],
      future: [],
    })

    const back = moveReaderNavigation(
      first,
      { chapter: 8, fraction: 0.2, fragment: 'target' },
      'back',
    )
    expect(back.location).toEqual({ chapter: 4, fraction: 0.42 })
    expect(back.trail.future).toEqual([{ chapter: 8, fraction: 0.2, fragment: 'target' }])

    const forward = moveReaderNavigation(back.trail, { chapter: 4, fraction: 0.43 }, 'forward')
    expect(forward.location).toEqual({
      chapter: 8,
      fraction: 0.2,
      fragment: 'target',
    })
    expect(forward.trail.past).toEqual([{ chapter: 4, fraction: 0.43 }])
  })

  test('fills a bounded calendar activity window without inventing reading time', () => {
    const window = readerActivityWindow(
      [
        { date: '2026-08-13', readMs: 60_000 },
        { date: '2026-08-15', readMs: 120_000 },
      ],
      '2026-08-15',
      3,
    )
    expect(window).toEqual([
      { date: '2026-08-13', readMs: 60_000 },
      { date: '2026-08-14', readMs: 0 },
      { date: '2026-08-15', readMs: 120_000 },
    ])
  })

  test('clamps invalid scroll fractions', () => {
    expect(readerProgressPercent(0, 2, -1)).toBe(0)
    expect(readerProgressPercent(1, 2, 3)).toBe(100)
  })

  test('migrates and bounds persisted reading appearance', () => {
    expect(
      normalizeReaderPreferences({
        fontSize: 99,
        fontFamily: 'serif',
        lineHeight: 1.95,
        measure: 58,
        pageMargin: 'roomy',
        textAlign: 'justify',
        viewMode: 'page',
        autoScrollSpeed: 99,
        speedReadingWpm: 487,
        highlightColor: 'blue',
        focusMode: 'ruler',
      }),
    ).toEqual({
      fontSize: 26,
      fontFamily: 'serif',
      lineHeight: 1.95,
      measure: 58,
      pageMargin: 'roomy',
      textAlign: 'justify',
      viewMode: 'page',
      autoScrollSpeed: 72,
      speedReadingWpm: 475,
      highlightColor: 'blue',
      focusMode: 'ruler',
    })
    expect(normalizeReaderPreferences({ fontFamily: 'fantasy', pageMargin: 'edge' })).toEqual(
      DEFAULT_READER_PREFERENCES,
    )
  })

  test('uses surrounding context across normalized whitespace to disambiguate passages', () => {
    const source =
      'Agentic Mesh is the title. Praise for Agentic Mesh The future of AI starts with systems.'
    expect(
      findReaderTextIndex(source, {
        quote: 'Agentic Mesh',
        before: 'Praise for',
        after: 'The future of AI',
      }),
    ).toBe(source.indexOf('Agentic Mesh', source.indexOf('Praise for')))
  })

  test('builds a stable contextual target for the closest repeated passage', () => {
    const source = 'First repeated phrase here. Later repeated phrase there.'
    const second = source.lastIndexOf('repeated phrase')
    const target = readerTextTargetAt(source, 'repeated\nphrase', second)
    expect(target).toEqual({
      quote: 'repeated phrase',
      before: 'First repeated phrase here. Later',
      after: 'there.',
    })
    expect(findReaderTextIndex(source, target!)).toBe(second)
  })

  test('uses quote and context as the annotation deduplication identity', () => {
    expect(
      readerTextTargetKey({
        quote: ' same\nquote ',
        before: ' left ',
        after: ' right ',
      }),
    ).toBe(
      readerTextTargetKey({
        quote: 'same quote',
        before: 'left',
        after: 'right',
      }),
    )
  })

  test('updates an existing annotation instead of duplicating the same anchor', () => {
    const first = {
      id: 'first',
      path: '/book.epub',
      chapter: 2,
      chapterTitle: 'Chapter',
      quote: 'Repeated passage',
      target: { quote: 'Repeated passage', before: 'Before', after: 'After' },
      color: 'yellow' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    const result = upsertReaderSavedQuote(
      [first],
      { ...first, id: 'second', color: 'blue' },
      '2026-02-01T00:00:00.000Z',
    )
    expect(result.id).toBe('first')
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      id: 'first',
      color: 'blue',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
    })
  })

  test('bounds auto-scroll frame distance after stalls', () => {
    expect(readerAutoScrollDistance(28, 16)).toBeCloseTo(0.448)
    expect(readerAutoScrollDistance(1_000, 1_000)).toBe(7.2)
    expect(readerAutoScrollDistance(Number.NaN, -10)).toBe(0)
  })

  test('chooses the visible focus block nearest the reading line', () => {
    expect(
      readerNearestFocusBlock(
        [
          { top: -120, bottom: -20 },
          { top: 120, bottom: 220 },
          { top: 360, bottom: 460 },
        ],
        0,
        500,
      ),
    ).toBe(1)
    expect(readerNearestFocusBlock([], 0, 500)).toBe(-1)
  })

  test('prepares locally paced speed-reading tokens and a stable starting position', () => {
    const tokens = readerSpeedTokens('Calm, deliberate reading. 阅读。')
    expect(tokens.map((token) => token.text)).toEqual([
      'Calm,',
      'deliberate',
      'reading.',
      '阅',
      '读',
      '。',
    ])
    expect(tokens[0]?.pauseFactor).toBe(1.45)
    expect(tokens[2]?.pauseFactor).toBe(2.2)
    expect(tokens[1]?.focusIndex).toBe(3)
    expect(readerSpeedStartIndex(tokens.length, 0.5)).toBe(3)
  })

  test('extracts bounded context around the visible reading fraction', () => {
    const source = Array.from({ length: 200 }, (_, index) => `word-${index}`).join(' ')
    const start = readerPassageAtFraction(source, 0, 90)
    const middle = readerPassageAtFraction(source, 0.5, 90)
    const end = readerPassageAtFraction(source, 1, 90)
    expect(start).toStartWith('word-0 ')
    expect(middle).toMatch(/word-10\d/u)
    expect(end).toEndWith('word-199')
    expect(Math.max(start.length, middle.length, end.length)).toBeLessThanOrEqual(90)
  })

  test('sorts the library without mutating the source shelf', () => {
    const books = [
      {
        path: '/z.epub',
        title: 'Book 10',
        format: 'epub' as const,
        size: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        path: '/a.fb2',
        title: 'Book 2',
        format: 'fb2' as const,
        size: 1,
        updatedAt: '2026-02-01T00:00:00.000Z',
      },
    ]
    expect(sortReaderBooks(books, 'title').map((book) => book.title)).toEqual(['Book 2', 'Book 10'])
    expect(sortReaderBooks(books, 'recent').map((book) => book.title)).toEqual([
      'Book 2',
      'Book 10',
    ])
    expect(
      sortReaderBooks(books, 'progress', (book) => (book.path === '/z.epub' ? 80 : 10))[0]?.title,
    ).toBe('Book 10')
    expect(books[0]?.title).toBe('Book 10')
  })

  test('validates and bounds portable annotation documents', () => {
    const annotations = parseReaderAnnotationExport({
      schema: 'localix.reader.annotations',
      version: 1,
      annotations: [
        {
          id: 'note-1',
          path: '/old/book.epub',
          chapter: 3,
          chapterTitle: 'Chapter',
          quote: ' Saved   quote ',
          target: { quote: 'Saved quote', before: 'Before', after: 'After' },
          color: 'violet',
          note: 'A note',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    expect(annotations[0]).toMatchObject({
      quote: 'Saved quote',
      color: 'violet',
      note: 'A note',
      target: { quote: 'Saved quote', before: 'Before', after: 'After' },
    })
    expect(() =>
      parseReaderAnnotationExport({
        schema: 'unknown',
        version: 1,
        annotations: [],
      }),
    ).toThrow('Unsupported annotation document')
  })
})
