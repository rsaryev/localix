import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The index cache stores whole `SessionSummary` values, so a change to that shape invalidates every
 * stored row — and `CACHE_VERSION` is the only thing that discards them.
 *
 * Forgetting the bump does not fail: a stale row parses fine and simply lacks the new field, so the
 * symptom is SILENCE on whichever surface reads it, until something else forces a rescan. That has
 * now happened twice on one version — `quotas` was added and then reshaped while the version sat
 * at 5 — and both times the surface just went blank.
 *
 * So the shape is pinned here. Add, rename or remove a stored field and this fails until someone
 * bumps `CACHE_VERSION` and updates the list, which is the decision that was being skipped. The list
 * is spelled out rather than hashed because the diff IS the message: it names what moved.
 *
 * Source-reading, following `apps/api/src/lib/validator.test.ts` — TypeScript types are erased at
 * runtime, so the declaration is the only thing there is to read.
 */
const CONTRACTS = join(import.meta.dir, '..', '..', 'shared', 'contracts.ts')
const INDEX_CACHE = join(import.meta.dir, 'index-cache.ts')

/**
 * Every interface whose fields end up INSIDE a stored summary.
 *
 * Hand-kept, and the one thing the failure message cannot tell you: a new field whose type is
 * another interface must be added HERE as well, or its own fields change unwatched behind a name
 * this list already covers.
 */
const STORED = [
  'SessionSummary',
  'SessionTokenUsage',
  'DailyTokenUsage',
  'ModelTokenUsage',
  'TokenUsage',
  'QuotaReading',
] as const

function fieldsOf(source: string, name: string): string[] {
  const start = source.indexOf(`export interface ${name} `)
  if (start === -1) return []
  const end = source.indexOf('\n}', start)
  const body = source.slice(start, end === -1 ? undefined : end)
  return [...body.matchAll(/^\s{2}readonly\s+([A-Za-z0-9_]+)\??:/gm)].map((m) => `${name}.${m[1]}`)
}

const PINNED = [
  'DailyTokenUsage.byModel',
  'DailyTokenUsage.day',
  'ModelTokenUsage.model',
  'QuotaReading.observedAt',
  'QuotaReading.planType',
  'QuotaReading.resetsAt',
  'QuotaReading.usedPercent',
  'QuotaReading.windowMinutes',
  'SessionSummary.cwd',
  'SessionSummary.key',
  'SessionSummary.messageCount',
  'SessionSummary.model',
  'SessionSummary.nativeSessionId',
  'SessionSummary.parentNativeSessionId',
  'SessionSummary.provider',
  'SessionSummary.quotas',
  'SessionSummary.sourcePath',
  'SessionSummary.startedAt',
  'SessionSummary.title',
  'SessionSummary.updatedAt',
  'SessionSummary.usage',
  'SessionTokenUsage.byDay',
  'SessionTokenUsage.byModel',
  'TokenUsage.cacheWriteTokens',
  'TokenUsage.cachedInputTokens',
  'TokenUsage.inputTokens',
  'TokenUsage.outputTokens',
  'TokenUsage.reasoningTokens',
  'TokenUsage.requests',
  'TokenUsage.totalTokens',
]

/**
 * The version the list above was pinned against. Bump BOTH together, never one.
 *
 * 8 is the counter-example this file cannot catch on its own: nothing in the shape moved — Gemini
 * sessions began RESOLVING a `cwd` that was always declared and always absent — so the list above is
 * unchanged and only the version moved. A derivation change invalidates cached rows exactly as a
 * field addition does; the difference is that only a human notices.
 */
const PINNED_AT_VERSION = 8

describe('a stored summary cannot change shape without discarding the cache', () => {
  const source = [CONTRACTS, join(import.meta.dir, '..', '..', 'shared', 'quotas.ts')]
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n')

  test('positive control: the reader actually finds fields', () => {
    // Without this, a regex that matched nothing would make the guard below pass forever — the
    // failure mode is silence there too.
    for (const name of STORED) {
      expect([name, fieldsOf(source, name).length > 0]).toEqual([name, true])
    }
    expect(fieldsOf(source, 'SessionSummary')).toContain('SessionSummary.key')
    // A name that is not there must yield nothing, or the reader is matching the whole file.
    expect(fieldsOf(source, 'NoSuchInterfaceHere')).toEqual([])
  })

  test('the stored shape is exactly what CACHE_VERSION was last bumped for', () => {
    const actual = STORED.flatMap((name) => fieldsOf(source, name)).sort()

    // If this fails, the fix is not to edit the list: it is to bump CACHE_VERSION in index-cache.ts
    // so existing caches are discarded, THEN update the list and PINNED_AT_VERSION to match.
    expect(actual).toEqual([...PINNED].sort())
  })

  test('the pin names the version the cache actually ships', () => {
    const declared = /const CACHE_VERSION = (\d+)/.exec(readFileSync(INDEX_CACHE, 'utf8'))

    expect(declared?.[1]).toBe(String(PINNED_AT_VERSION))
  })
})
