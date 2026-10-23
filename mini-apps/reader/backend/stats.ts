import type { MiniAppHelpers } from '@localixai/mini-app-sdk/backend'

import type {
  ReaderBookStats,
  ReaderReadingEventInput,
  ReaderSource,
  ReaderStatsResponse,
} from '../shared/contracts'

const MIN_EVENT_MS = 3_000
const MAX_EVENT_MS = 120_000
const MAX_EVENTS = 50_000
const MAX_CLOCK_SKEW_MS = 5 * 60_000
const EMPTY_STATS: ReaderBookStats = {
  readMs: 0,
  sessionCount: 0,
  positionsRead: 0,
  activeDays: 0,
  currentStreakDays: 0,
  longestStreakDays: 0,
  averageSessionMs: 0,
  progress: 0,
  daily: [],
}

interface StoredReadingEvent extends Omit<ReaderReadingEventInput, 'source'> {
  sourceKey: string
  durationMs: number
}

interface StoredReaderStats {
  version?: number
  events: StoredReadingEvent[]
}

interface ReaderStatsPersistence {
  filePath: string
  helpers: Pick<MiniAppHelpers, 'readJson' | 'writeJson'>
}

function isStoredReadingEvent(value: unknown): value is StoredReadingEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<StoredReadingEvent>
  return (
    typeof event.id === 'string' &&
    event.id.length > 0 &&
    event.id.length <= 128 &&
    typeof event.sourceKey === 'string' &&
    event.sourceKey.length > 0 &&
    event.sourceKey.length <= 4_200 &&
    typeof event.sessionId === 'string' &&
    event.sessionId.length > 0 &&
    event.sessionId.length <= 128 &&
    typeof event.startedAt === 'string' &&
    typeof event.endedAt === 'string' &&
    Number.isInteger(event.chapter) &&
    Number.isInteger(event.position) &&
    Number.isInteger(event.totalPositions) &&
    typeof event.progress === 'number' &&
    typeof event.timezoneOffset === 'number' &&
    typeof event.durationMs === 'number' &&
    event.durationMs >= MIN_EVENT_MS &&
    event.durationMs <= MAX_EVENT_MS
  )
}

function isStoredReaderStats(value: unknown): value is StoredReaderStats {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<StoredReaderStats>
  return (
    Array.isArray(state.events) &&
    state.events.length <= MAX_EVENTS &&
    state.events.every(isStoredReadingEvent)
  )
}

export function readerStatsSourceKey(source: ReaderSource): string {
  return 'path' in source ? `path:${source.path}` : `media:${source.mediaId}`
}

function localDate(timestamp: string, timezoneOffset: number): string {
  return new Date(new Date(timestamp).getTime() - timezoneOffset * 60_000)
    .toISOString()
    .slice(0, 10)
}

function dayNumber(date: string): number {
  return Math.floor(new Date(`${date}T00:00:00.000Z`).getTime() / 86_400_000)
}

export function aggregateReaderStats(
  events: readonly StoredReadingEvent[],
  now = new Date(),
): ReaderBookStats {
  if (events.length === 0) return { ...EMPTY_STATS, daily: [] }
  const ordered = [...events].sort((left, right) => left.endedAt.localeCompare(right.endedAt))
  const dailyMap = new Map<string, number>()
  const sessions = new Map<string, number>()
  const positions = new Set<string>()
  let readMs = 0
  for (const event of ordered) {
    readMs += event.durationMs
    const date = localDate(event.endedAt, event.timezoneOffset)
    dailyMap.set(date, (dailyMap.get(date) ?? 0) + event.durationMs)
    const sessionKey = `${event.sourceKey}\0${event.sessionId}`
    sessions.set(sessionKey, (sessions.get(sessionKey) ?? 0) + event.durationMs)
    positions.add(`${event.sourceKey}\0${event.chapter}\0${event.position}`)
  }
  const dates = [...dailyMap.keys()].sort()
  let longestStreakDays = 0
  let streak = 0
  let previousDay: number | undefined
  for (const date of dates) {
    const day = dayNumber(date)
    streak = previousDay !== undefined && day === previousDay + 1 ? streak + 1 : 1
    longestStreakDays = Math.max(longestStreakDays, streak)
    previousDay = day
  }
  const latest = ordered.at(-1)!
  const today = localDate(now.toISOString(), latest.timezoneOffset)
  const lastDate = dates.at(-1)!
  const age = dayNumber(today) - dayNumber(lastDate)
  const currentStreakDays = age <= 1 ? streak : 0
  return {
    readMs,
    sessionCount: sessions.size,
    positionsRead: positions.size,
    activeDays: dates.length,
    currentStreakDays,
    longestStreakDays,
    averageSessionMs: Math.round(readMs / sessions.size),
    startedAt: ordered[0]!.startedAt,
    lastReadAt: latest.endedAt,
    progress: latest.progress,
    daily: dates.map((date) => ({ date, readMs: dailyMap.get(date)! })).slice(-14),
  }
}

export class ReaderStatsService {
  private events: StoredReadingEvent[] = []
  private readonly ids = new Set<string>()
  private loadPromise?: Promise<void>
  private savePromise: Promise<void> = Promise.resolve()

  constructor(private readonly persistence?: ReaderStatsPersistence) {}

  async record(input: ReaderReadingEventInput, now = new Date()): Promise<boolean> {
    await this.ensureLoaded()
    if (this.ids.has(input.id)) return false
    const started = new Date(input.startedAt).getTime()
    const ended = new Date(input.endedAt).getTime()
    if (!Number.isFinite(started) || !Number.isFinite(ended) || ended <= started) {
      throw new Error('Invalid reading event time range')
    }
    if (ended > now.getTime() + MAX_CLOCK_SKEW_MS) throw new Error('Reading event is in the future')
    const durationMs = Math.min(MAX_EVENT_MS, Math.round(ended - started))
    if (durationMs < MIN_EVENT_MS) return false
    const { source: _source, ...eventInput } = input
    const event: StoredReadingEvent = {
      ...eventInput,
      sourceKey: readerStatsSourceKey(input.source),
      durationMs,
      chapter: Math.max(0, Math.min(100_000, Math.round(input.chapter))),
      position: Math.max(1, Math.min(1_000_000, Math.round(input.position))),
      totalPositions: Math.max(1, Math.min(1_000_000, Math.round(input.totalPositions))),
      progress: Math.max(0, Math.min(100, input.progress)),
      timezoneOffset: Math.max(-840, Math.min(840, Math.round(input.timezoneOffset))),
    }
    this.events.push(event)
    this.ids.add(event.id)
    if (this.events.length > MAX_EVENTS) {
      const removed = this.events.splice(0, this.events.length - MAX_EVENTS)
      for (const item of removed) this.ids.delete(item.id)
    }
    await this.persist()
    return true
  }

  async get(source: ReaderSource, now = new Date()): Promise<ReaderStatsResponse> {
    await this.ensureLoaded()
    const sourceKey = readerStatsSourceKey(source)
    return {
      book: aggregateReaderStats(
        this.events.filter((event) => event.sourceKey === sourceKey),
        now,
      ),
      library: aggregateReaderStats(this.events, now),
    }
  }

  private ensureLoaded(): Promise<void> {
    if (!this.persistence) return Promise.resolve()
    this.loadPromise ??= this.persistence.helpers
      .readJson<StoredReaderStats>(this.persistence.filePath, { events: [] }, isStoredReaderStats)
      .then((state) => {
        this.events = state.events
        for (const event of this.events) this.ids.add(event.id)
      })
    return this.loadPromise
  }

  private persist(): Promise<void> {
    if (!this.persistence) return Promise.resolve()
    const snapshot: StoredReaderStats = { version: 1, events: this.events }
    this.savePromise = this.savePromise
      .catch(() => undefined)
      .then(() => this.persistence!.helpers.writeJson(this.persistence!.filePath, snapshot))
    return this.savePromise
  }
}
