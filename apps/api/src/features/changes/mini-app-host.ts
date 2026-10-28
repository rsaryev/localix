/**
 * `host.changes` for one mini app: the change feed on the mini app's own stream
 * (`mini-app:<name>`). The core's registry is typed and closed; a mini app's kinds are its own, so
 * its stream takes any kind with a valid name and any JSON object as a ref — the mini app types its
 * notices itself. Every mini app feed is kept here so their retention runs with the core's. A mini
 * app also follows the core's deletions read-only (`core-deletions.ts`); it can never record on the
 * core stream.
 */
import type { Kysely } from 'kysely'
import { z } from 'zod'
import type { ChangeFeedHost, MiniAppChange } from '@localixai/mini-app-sdk/backend'
import {
  createChangeFeed,
  recordChanges,
  type ChangeFeed,
  type ConsumerHandlers,
  type EntityRegistry,
  type RefSchemas,
} from '@localixai/change-feed'
import type { AppDatabase } from '../../db/types'
import { createOwnedRegistrations, type SettleOutcome } from '../../lib/owned-registrations'
import { changeRetryDelayMs } from './retry'
import type { CoreChangeFeed } from './core-entities'
import { createCoreDeletionFollower } from './core-deletions'
import { agentLivesOn } from './change-events-repository'

const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/
const ANY_REF = z.record(z.string(), z.unknown())

/** Every kind a mini app names, with an object ref; no cascades (a mini app cleans up its own). */
const openRegistry: EntityRegistry<RefSchemas, Record<string, never>> = {
  refs: new Proxy({} as RefSchemas, {
    get: (_, kind) => (typeof kind === 'string' ? ANY_REF : undefined),
  }),
  cascades: {},
}

type Log = (event: string, detail: Record<string, unknown>) => void

export function createMiniAppChangeHosts(deps: {
  db: Kysely<AppDatabase>
  /** The core stream a mini app follows deletions on (read-only). */
  core: CoreChangeFeed
  log?: Log
}) {
  const followCore = createCoreDeletionFollower({
    agentLivesOn: (agentId) => agentLivesOn(deps.db, agentId),
    core: deps.core,
  })
  // `record` is fire-and-forget for the mini app; `settle` waits for these writes to land.
  const recording = new Set<Promise<unknown>>()
  const feeds = new Map<string, ChangeFeed<RefSchemas, Record<string, never>>>()
  const feedFor = (stream: string) => {
    let feed = feeds.get(stream)
    if (!feed) {
      feed = createChangeFeed({
        db: deps.db,
        stream,
        registry: openRegistry,
        retryDelayMs: changeRetryDelayMs,
        log: deps.log,
      })
      feeds.set(stream, feed)
    }
    return feed
  }

  /** What each mini app's backend holds, so a reloaded backend replaces its own subscriptions. */
  const registrations = createOwnedRegistrations()

  return {
    forMiniApp(miniAppName: string): ChangeFeedHost {
      const stream = `mini-app:${miniAppName}`
      const valid = (change: MiniAppChange) => NAME.test(change.entity)
      return {
        record(changes) {
          const list = (Array.isArray(changes) ? changes : [changes]) as readonly MiniAppChange[]
          const kept = list.filter(valid)
          if (kept.length < list.length) {
            deps.log?.('changes.mini_app_invalid_entity', { miniApp: miniAppName })
          }
          const write = recordChanges(deps.db, stream, kept)
          recording.add(write)
          void write.then(
            () => recording.delete(write),
            () => recording.delete(write),
          )
        },
        async subscribe(consumer, handler) {
          if (!NAME.test(consumer)) throw new Error(`invalid change consumer name "${consumer}"`)
          // The same mini app subscribing again is its backend being loaded again: the feed keeps
          // ONE subscription under the consumer name and this load's handler answers through it.
          // Which load answers is the backend host's verdict (`settle`), so a duplicate it discards
          // never displaces the wired backend. A mini app's handler acts on its own data; the host
          // never rebuilds it.
          const { dispose, opened } = registrations.bind(
            miniAppName,
            `consumer:${consumer}`,
            handler,
            async (current) => {
              // One handler answers for every kind the mini app names.
              const handlers = new Proxy(
                {} as ConsumerHandlers<RefSchemas, Record<string, never>>,
                { get: () => (delivery: MiniAppChange) => current()(delivery) },
              )
              const started = await feedFor(stream).subscribe(consumer, handlers, {
                kind: 'reactor',
              })
              return () => started.stop()
            },
          )
          await opened
          return async () => dispose()
        },
        async followCoreDeletions(consumer, handler) {
          if (!NAME.test(consumer)) throw new Error(`invalid change consumer name "${consumer}"`)
          return followCore(miniAppName, consumer, handler)
        },
      }
    },

    /** The mini app is gone (disabled or removed): stop the subscriptions its backend held. */
    releaseMiniApp: (miniAppName: string) => registrations.releaseOwner(miniAppName),

    /** The backend host's verdict on a pass that loaded the mini app again: which load answers. */
    settleMiniApp: (miniAppName: string, outcome: SettleOutcome) =>
      registrations.settle(miniAppName, outcome),

    /** Tests: the recorded changes are written and every mini app consumer has read them. */
    async settle(): Promise<void> {
      while (recording.size > 0) await Promise.allSettled(recording)
      for (const feed of feeds.values()) await feed.settle()
    },

    /** Retention for every mini app stream (with the core's). */
    async prune(now?: number): Promise<number> {
      let removed = 0
      for (const feed of feeds.values()) removed += await feed.prune(now)
      return removed
    },

    async close() {
      for (const feed of feeds.values()) await feed.close()
      feeds.clear()
    },
  }
}

export type MiniAppChangeHosts = ReturnType<typeof createMiniAppChangeHosts>
