import { describe, expect, test } from 'bun:test'

import type { ReaderReadingEventInput } from '../shared/contracts'
import { ReaderStatsService } from './stats'

function event(
  id: string,
  startedAt: string,
  endedAt: string,
  patch: Partial<ReaderReadingEventInput> = {},
): ReaderReadingEventInput {
  return {
    id,
    source: { path: '/books/reader.epub' },
    sessionId: 'session-1',
    startedAt,
    endedAt,
    chapter: 0,
    position: 1,
    totalPositions: 10,
    progress: 10,
    timezoneOffset: 0,
    ...patch,
  }
}

describe('ReaderStatsService', () => {
  test('deduplicates retries, ignores brief noise, and caps background duration', async () => {
    const service = new ReaderStatsService()
    expect(
      await service.record(event('brief', '2026-08-10T10:00:00.000Z', '2026-08-10T10:00:02.000Z')),
    ).toBe(false)
    expect(
      await service.record(event('page-1', '2026-08-10T10:00:00.000Z', '2026-08-10T10:03:00.000Z')),
    ).toBe(true)
    expect(
      await service.record(event('page-1', '2026-08-10T10:00:00.000Z', '2026-08-10T10:03:00.000Z')),
    ).toBe(false)
    const result = await service.get({ path: '/books/reader.epub' })
    expect(result.book).toMatchObject({
      readMs: 120_000,
      sessionCount: 1,
      positionsRead: 1,
      activeDays: 1,
    })
  })

  test('derives local-day streaks and separates books from library totals', async () => {
    const service = new ReaderStatsService()
    await service.record(
      event('one', '2026-08-11T21:59:50.000Z', '2026-08-11T22:00:00.000Z', {
        timezoneOffset: -120,
      }),
    )
    await service.record(
      event('two', '2026-08-12T21:59:50.000Z', '2026-08-12T22:00:00.000Z', {
        timezoneOffset: -120,
        sessionId: 'session-2',
        position: 2,
        progress: 20,
      }),
    )
    await service.record(
      event('other', '2026-08-12T22:59:50.000Z', '2026-08-12T23:00:00.000Z', {
        source: { mediaId: 'other-book' },
      }),
    )
    const result = await service.get(
      { path: '/books/reader.epub' },
      new Date('2026-08-13T12:00:00.000Z'),
    )
    expect(result.book).toMatchObject({
      readMs: 20_000,
      sessionCount: 2,
      positionsRead: 2,
      activeDays: 2,
      currentStreakDays: 2,
      longestStreakDays: 2,
      progress: 20,
    })
    expect(result.book.daily.map((item) => item.date)).toEqual(['2026-08-12', '2026-08-13'])
    expect(result.library.readMs).toBe(30_000)
  })
})
