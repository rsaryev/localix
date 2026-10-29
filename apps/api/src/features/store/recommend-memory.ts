import type { ListingRef } from '@localixai/store'

import { refKey } from './index-rows'
import type {
  DismissalReason,
  StoreDismissalsPort,
  StoreRecommendationEventsPort,
} from './service-types'

/**
 * What the recommendations remember, kept in memory: the Store a harness builds without a
 * database. The same answers as the repositories (`dismissals-repository.ts`,
 * `recommendation-events-repository.ts`), forgotten on restart.
 */

export function memoryDismissals(): StoreDismissalsPort {
  /** Per person, `kind:id` to its entry, oldest first; the first reason stands. */
  const held = new Map<string, Map<string, { ref: ListingRef; reason: DismissalReason }>>()
  const of = (userId: string) => held.get(userId) ?? new Map()
  return {
    list: async (userId) => new Set(of(userId).keys()),
    entries: async (userId) => [...of(userId).values()].reverse(),
    async set(userId, ref, reason) {
      const entries = of(userId)
      if (!reason) entries.delete(refKey(ref))
      else if (!entries.has(refKey(ref))) entries.set(refKey(ref), { ref, reason })
      held.set(userId, entries)
    },
  }
}

interface Logged {
  userId: string
  key: string
  event: 'shown' | 'opened' | 'installed'
  slot: number | undefined
  source: string | undefined
  at: string
}

export function memoryRecommendationEvents(): StoreRecommendationEventsPort {
  const log: Logged[] = []
  const since = (userId: string, from: string) =>
    log.filter((entry) => entry.userId === userId && entry.at >= from)
  return {
    async record(userId, events, at) {
      for (const event of events)
        log.push({
          userId,
          key: refKey(event.ref),
          event: event.event,
          slot: event.slot,
          source: event.source,
          at,
        })
    },
    async installed(userId, ref, at, from) {
      const shown = since(userId, from)
        .reverse()
        .find((entry) => entry.key === refKey(ref) && entry.event === 'shown')
      log.push({
        userId,
        key: refKey(ref),
        event: 'installed',
        slot: shown?.slot,
        source: shown?.source,
        at,
      })
    },
    async installedAt(userId, keys) {
      const out = new Map<string, string>()
      for (const entry of log)
        if (entry.userId === userId && entry.event === 'installed' && keys.includes(entry.key))
          if ((out.get(entry.key) ?? '') < entry.at) out.set(entry.key, entry.at)
      return out
    },
    async exposure(userId, from) {
      const out = new Map<string, { days: Set<string>; opened: boolean }>()
      for (const entry of since(userId, from)) {
        const seen = out.get(entry.key) ?? { days: new Set<string>(), opened: false }
        if (entry.event === 'shown') seen.days.add(entry.at.slice(0, 10))
        if (entry.event === 'opened') seen.opened = true
        out.set(entry.key, seen)
      }
      return new Map(
        [...out].map(([key, seen]) => [key, { days: seen.days.size, opened: seen.opened }]),
      )
    },
    async stats(userId, from) {
      const out: Record<string, { shown: number; opened: number; installed: number }> = {}
      for (const entry of since(userId, from))
        if (entry.source)
          (out[entry.source] ??= { shown: 0, opened: 0, installed: 0 })[entry.event]++
      return out
    },
  }
}
