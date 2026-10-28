import { useCallback, useEffect, useRef, useState } from 'react'
import { acknowledgeInline } from '@localixai/mini-app-sdk/ui'

import { Button } from '@localixai/kit/button'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'

import type { ReaderSource, ReaderStatsResponse } from '../shared/contracts'
import { readerApi } from './api'
import { useLatest } from '@localixai/mini-app-sdk/ui/runtime-hooks'
import { readerActivityWindow } from './model'
import { useReaderPaneProblem } from './readerSources'
import './reader.css'

/**
 * Time actually spent reading, and the panel that reports it.
 *
 * The tracker is the interesting half: reading is not a stream of events, so "was this person
 * reading" is inferred from activity within a window and flushed on a cadence, with a floor that
 * throws away sessions too short to mean anything. Carved out of `ReaderWorkspace.tsx` (4,386
 * lines) with the panel it feeds, because the thresholds and the display of them are one decision.
 */
const READER_IDLE_MS = 120_000
const READER_STATS_FLUSH_MS = 30_000
const READER_STATS_MIN_MS = 3_000

export function useReaderStatsTracker({
  source,
  enabled,
  chapter,
  position,
  totalPositions,
  progress,
  observe,
}: {
  source: ReaderSource
  enabled: boolean
  chapter: number
  position: number
  totalPositions: number
  progress: number
  observe: boolean
}) {
  const [stats, setStats] = useState<ReaderStatsResponse | null>(null)
  // Observing a book's stats begins a read of them, so the panel is loading from the render that
  // observes, not a render later.
  const observed = observe ? source : null
  const [loading, setLoading] = useState(observed !== null)
  const [observedBefore, setObservedBefore] = useState(observed)
  if (observedBefore !== observed) {
    setObservedBefore(observed)
    if (observed) setLoading(true)
  }
  const [error, setError] = useState<string | null>(null)
  const sessionIdRef = useRef(crypto.randomUUID())
  const segmentStartRef = useRef<number | null>(null)
  const lastActivityRef = useRef(0)
  const observeRef = useLatest(observe)
  const progressRef = useLatest(progress)
  const metricsRef = useRef({ chapter, position, totalPositions })

  // One read of the stats: what it settles is set when the answer arrives.
  const read = useCallback(
    () =>
      new Promise<ReaderStatsResponse>((resolve) => resolve(readerApi.stats(source)))
        .then(
          (next) => {
            setStats(next)
            setError(null)
          },
          (cause: unknown) => {
            acknowledgeInline(cause)
            setError(cause instanceof Error ? cause.message : String(cause))
          },
        )
        .finally(() => setLoading(false)),
    [source],
  )
  /** A read asked for from outside (a retry, a new session recorded) shows as loading. */
  const load = useCallback(() => {
    setLoading(true)
    return read()
  }, [read])

  const flush = useCallback(
    (stop: boolean) => {
      const started = segmentStartRef.current
      if (started === null) return
      const now = Date.now()
      const ended = Math.min(now, lastActivityRef.current + READER_IDLE_MS)
      segmentStartRef.current = stop || ended < now ? null : now
      if (ended - started < READER_STATS_MIN_MS) return
      const metrics = metricsRef.current
      void readerApi
        .recordReadingEvent({
          id: crypto.randomUUID(),
          source,
          sessionId: sessionIdRef.current,
          startedAt: new Date(started).toISOString(),
          endedAt: new Date(ended).toISOString(),
          chapter: metrics.chapter,
          position: metrics.position,
          totalPositions: metrics.totalPositions,
          progress: progressRef.current,
          timezoneOffset: new Date(ended).getTimezoneOffset(),
        })
        .then(() => {
          if (observeRef.current) void load()
        })
        .catch(() => undefined)
    },
    [load, source, observeRef, progressRef],
  )

  const markActivity = useCallback(() => {
    if (!enabled || document.visibilityState === 'hidden') return
    const now = Date.now()
    lastActivityRef.current = now
    segmentStartRef.current ??= now
  }, [enabled])

  useEffect(() => {
    flush(false)
    metricsRef.current = { chapter, position, totalPositions }
    markActivity()
  }, [chapter, flush, markActivity, position, totalPositions])

  useEffect(() => {
    if (!enabled) {
      flush(true)
      return
    }
    markActivity()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush(true)
      else markActivity()
    }
    const onPageHide = () => flush(true)
    const timer = window.setInterval(() => flush(false), READER_STATS_FLUSH_MS)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      flush(true)
    }
  }, [enabled, flush, markActivity])

  useEffect(() => {
    if (observe) void read()
  }, [read, observe])

  return { stats, loading, error, load, markActivity }
}

function readableDuration(milliseconds: number): string {
  if (milliseconds < 60_000) return `${Math.max(1, Math.round(milliseconds / 1_000))} sec`
  const minutes = Math.max(0, Math.round(milliseconds / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours} h ${remainder} min` : `${hours} h`
}

function localDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

/**
 * The raw text under the sentence, or nothing. An `Error` we already quote adds nothing twice; a
 * `ReaderApiError` carries what the parser said, and a non-Error throw has only its own value.
 */
export function ReaderStatsPanel({
  result,
  loading,
  error,
  onRetry,
}: {
  result: ReaderStatsResponse | null
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
  const [today] = useState(() => localDateKey(new Date()))
  const problem = useReaderPaneProblem('reading activity', result ? null : error, [
    { id: 'retry', label: 'Try again', run: onRetry },
  ])
  if (loading && !result) return <LoadingHint>Loading reading activity…</LoadingHint>
  if (error && !result) return problem
  const stats = result?.book
  if (!stats?.readMs) {
    return (
      <EmptyHint className="min-h-40 px-3">
        Reading time appears here after a few active seconds in this book.
      </EmptyHint>
    )
  }
  const activity = readerActivityWindow(stats.daily, today)
  const peak = Math.max(...activity.map((day) => day.readMs), 1)
  return (
    <div className="space-y-5 p-3">
      <div>
        <div className="text-2xs font-medium tracking-wide text-text-faint uppercase">
          Time in this book
        </div>
        <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
          {readableDuration(stats.readMs)}
        </div>
        <div className="mt-1 text-2xs text-text-faint">
          {stats.sessionCount} {stats.sessionCount === 1 ? 'session' : 'sessions'} ·{' '}
          {stats.activeDays} active {stats.activeDays === 1 ? 'day' : 'days'}
        </div>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between text-2xs text-text-faint">
          <span>Recent activity</span>
          <span>Last 14 days</span>
        </div>
        <div className="flex h-16 items-end gap-1" aria-label="Recent reading activity">
          {activity.map((day) => (
            <div
              key={day.date}
              className="min-h-1 flex-1 rounded-sm bg-foreground/10 data-[active=true]:bg-foreground/25"
              data-active={day.readMs > 0 || undefined}
              style={{
                height: `${day.readMs ? Math.max(8, Math.round((day.readMs / peak) * 100)) : 6}%`,
              }}
              title={
                day.readMs
                  ? `${day.date}: ${readableDuration(day.readMs)}`
                  : `${day.date}: no reading`
              }
            />
          ))}
        </div>
      </div>
      <dl className="divide-y divide-border border-y border-border text-xs">
        <div className="flex items-center justify-between py-2">
          <dt className="text-text-faint">Current streak</dt>
          <dd className="tabular-nums">
            {stats.currentStreakDays} {stats.currentStreakDays === 1 ? 'day' : 'days'}
          </dd>
        </div>
        <div className="flex items-center justify-between py-2">
          <dt className="text-text-faint">Longest streak</dt>
          <dd className="tabular-nums">
            {stats.longestStreakDays} {stats.longestStreakDays === 1 ? 'day' : 'days'}
          </dd>
        </div>
        <div className="flex items-center justify-between py-2">
          <dt className="text-text-faint">Average session</dt>
          <dd className="tabular-nums">{readableDuration(stats.averageSessionMs)}</dd>
        </div>
        <div className="flex items-center justify-between py-2">
          <dt className="text-text-faint">Positions read</dt>
          <dd className="tabular-nums">{stats.positionsRead}</dd>
        </div>
      </dl>
      {error && (
        <Button variant="ghost" size="sm" className="text-text-faint" onClick={onRetry}>
          Refresh activity
        </Button>
      )}
    </div>
  )
}
