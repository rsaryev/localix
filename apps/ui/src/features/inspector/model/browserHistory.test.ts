import { describe, expect, test } from 'bun:test'
import { addBrowserVisit, historyDays, visitName, type BrowserVisit } from './browserHistory'

describe('browser history', () => {
  test('keeps one recent entry per URL and preserves a known title', () => {
    const first = addBrowserVisit([], 'https://example.com/', 'Example', 1)
    const next = addBrowserVisit(first, 'https://other.example/', undefined, 2)
    const revisited = addBrowserVisit(next, 'https://example.com/', undefined, 3)
    expect(revisited).toEqual([
      { url: 'https://example.com/', title: 'Example', visitedAt: 3 },
      { url: 'https://other.example/', title: undefined, visitedAt: 2 },
    ])
  })

  test('ignores internal and unsafe URLs and bounds storage', () => {
    const many: BrowserVisit[] = Array.from({ length: 150 }, (_, index) => ({
      url: `https://example.com/${index}`,
      visitedAt: index,
    }))
    expect(addBrowserVisit(many, 'javascript:alert(1)')).toBe(many)
    const next = addBrowserVisit(many, 'https://new.example/', undefined, 200)
    expect(next).toHaveLength(150)
    expect(next[0]?.url).toBe('https://new.example/')
    expect(next.at(-1)?.url).toBe('https://example.com/148')
  })

  test('a page is named by its title over its address, and never by one address twice', () => {
    expect(visitName({ url: 'https://www.example.com/docs', title: 'Docs', visitedAt: 1 })).toEqual(
      { title: 'Docs', address: 'example.com/docs' },
    )
    expect(visitName({ url: 'https://github.com/', visitedAt: 1 })).toEqual({ title: 'github.com' })
    expect(visitName({ url: 'https://github.com/', title: 'github.com', visitedAt: 1 })).toEqual({
      title: 'github.com',
    })
  })

  test('history reads as its days, newest first, each day named once', () => {
    const now = new Date('2026-09-11T15:00:00')
    const at = (iso: string) => new Date(iso).getTime()
    const days = historyDays(
      [
        { url: 'https://c.example/', visitedAt: at('2026-09-11T14:00:00') },
        { url: 'https://b.example/', visitedAt: at('2026-09-11T08:00:00') },
        { url: 'https://a.example/', visitedAt: at('2026-09-10T22:00:00') },
      ],
      now,
    )
    expect(days.map((day) => day.label)).toEqual(['Today', 'Yesterday'])
    expect(days[0]?.visits.map((visit) => visit.url)).toEqual([
      'https://c.example/',
      'https://b.example/',
    ])
  })
})
