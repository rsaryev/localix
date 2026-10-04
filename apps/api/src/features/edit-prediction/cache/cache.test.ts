/**
 * L1 backend cache — TTL, LRU-by-bytes, namespace, and single-flight (incl. the
 * one-subscriber-cancel guarantee). Deterministic via an injected clock.
 */

import { describe, expect, it } from 'bun:test'
import { createEditPredictionCache } from './memory'
import { buildResultCacheKey, editHistoryDigest, type ResultCacheKeyParts } from './keys'
import type { NextEditResult } from '../contracts'

const PREDICTED: NextEditResult = {
  outcome: 'predicted',
  edits: [{ startLine: 1, endLine: 1, original: 'a', replacement: 'b' }],
}
const EMPTY: NextEditResult = { outcome: 'empty', edits: null }

const baseParts: ResultCacheKeyParts = {
  userId: 'u',
  documentDigest: 'd1',
  cursorLine: 3,
  editHistoryDigest: 'none',
  contextFingerprint: 'cf',
  modelId: 'm',
}

describe('buildResultCacheKey', () => {
  it('is stable for identical parts and namespaced', () => {
    expect(buildResultCacheKey(baseParts)).toBe(buildResultCacheKey({ ...baseParts }))
    // The schema segment is a cache-invalidation counter: a prompt change bumps it so
    // entries written under the old wording can never be served against the new one.
    expect(buildResultCacheKey(baseParts).startsWith('ep2:s3:')).toBe(true)
  })

  it('differs on every semantic field', () => {
    const base = buildResultCacheKey(baseParts)
    const variants: Array<Partial<ResultCacheKeyParts>> = [
      { userId: 'u2' },
      { projectRoot: '/p' },
      { isolationId: 'wt' },
      { documentDigest: 'd2' },
      { documentVersion: 9 },
      { cursorLine: 4 },
      { cursorColumn: 2 },
      { triggerClass: 'paste' },
      { editHistoryDigest: 'h' },
      { contextFingerprint: 'cf2' },
      { modelId: 'm2' },
      { providerConnectionId: 'pc' },
    ]
    for (const v of variants) expect(buildResultCacheKey({ ...baseParts, ...v })).not.toBe(base)
  })

  it('selections affect the key', () => {
    const withSel = buildResultCacheKey({
      ...baseParts,
      selections: [{ anchorLine: 1, anchorCol: 0, headLine: 2, headCol: 3 }],
    })
    expect(withSel).not.toBe(buildResultCacheKey(baseParts))
  })
})

describe('editHistoryDigest', () => {
  it('none for empty, stable + order-sensitive otherwise', () => {
    expect(editHistoryDigest([])).toBe('none')
    const a = editHistoryDigest([{ lines: ['x'], startLine: 1, endLine: 1 }])
    expect(a).toBe(editHistoryDigest([{ lines: ['x'], startLine: 1, endLine: 1 }]))
    expect(a).not.toBe(editHistoryDigest([{ lines: ['y'], startLine: 1, endLine: 1 }]))
  })
})

describe('result cache — TTL + LRU', () => {
  it('stores and serves a fresh positive hit; misses after positive TTL', () => {
    let t = 1000
    const cache = createEditPredictionCache({ now: () => t, positiveTtlMs: 100, negativeTtlMs: 10 })
    cache.set('k', PREDICTED)
    expect(cache.get('k')).toEqual(PREDICTED)
    t += 99
    expect(cache.get('k')).toEqual(PREDICTED)
    t += 2
    expect(cache.get('k')).toBeUndefined()
  })

  it('negative TTL is shorter than positive', () => {
    let t = 0
    const cache = createEditPredictionCache({ now: () => t, positiveTtlMs: 100, negativeTtlMs: 10 })
    cache.set('k', EMPTY)
    t = 11
    expect(cache.get('k')).toBeUndefined()
  })

  it('never caches non-success outcomes', () => {
    const cache = createEditPredictionCache()
    for (const outcome of [
      'cancelled',
      'deadline_exceeded',
      'provider_error',
      'no_model',
    ] as const) {
      cache.set('k', { outcome, edits: null })
      expect(cache.get('k')).toBeUndefined()
    }
  })

  it('evicts LRU entries to stay under the byte ceiling', () => {
    const one = JSON.stringify(PREDICTED).length
    const cache = createEditPredictionCache({ maxBytes: one * 2 + 1 })
    cache.set('a', PREDICTED)
    cache.set('b', PREDICTED)
    // touch 'a' so 'b' is the LRU victim
    expect(cache.get('a')).toBeTruthy()
    cache.set('c', PREDICTED)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBeTruthy()
    expect(cache.get('c')).toBeTruthy()
    expect(cache.stats().bytes).toBeLessThanOrEqual(one * 2 + 1)
  })
})

describe('single-flight', () => {
  it('shares ONE compute for identical concurrent fingerprints', async () => {
    const cache = createEditPredictionCache()
    let calls = 0
    let resolveFn!: (v: NextEditResult) => void
    const factory = () => {
      calls++
      return new Promise<NextEditResult>((r) => {
        resolveFn = r
      })
    }
    const a = cache.run('k', factory)
    const b = cache.run('k', factory)
    expect(calls).toBe(1)
    resolveFn(PREDICTED)
    expect(await a).toEqual(PREDICTED)
    expect(await b).toEqual(PREDICTED)
  })

  it('caches a shared success exactly once', async () => {
    const cache = createEditPredictionCache()
    await cache.run('k', async () => PREDICTED)
    expect(cache.get('k')).toEqual(PREDICTED)
    // a later miss? no — the stored value serves without recompute
    let calls = 0
    await cache.run('k2', async () => {
      calls++
      return EMPTY
    })
    expect(calls).toBe(1)
    expect(cache.get('k2')).toEqual(EMPTY)
  })

  it('one subscriber cancelling does NOT cancel shared work', async () => {
    const cache = createEditPredictionCache()
    let sharedAborted = false
    let resolveFn!: (v: NextEditResult) => void
    const factory = (signal: AbortSignal) => {
      signal.addEventListener('abort', () => {
        sharedAborted = true
      })
      return new Promise<NextEditResult>((r) => {
        resolveFn = r
      })
    }
    const ctrlA = new AbortController()
    const a = cache.run('k', factory, ctrlA.signal)
    const b = cache.run('k', factory) // no signal — stays subscribed
    ctrlA.abort()
    expect(await a).toEqual({ outcome: 'cancelled', edits: null })
    expect(sharedAborted).toBe(false) // b still subscribed → shared work continues
    resolveFn(PREDICTED)
    expect(await b).toEqual(PREDICTED)
    expect(cache.get('k')).toEqual(PREDICTED) // shared success still cached
  })

  it('aborts shared work only when the LAST subscriber leaves', async () => {
    const cache = createEditPredictionCache()
    let sharedAborted = false
    const factory = (signal: AbortSignal) => {
      signal.addEventListener('abort', () => {
        sharedAborted = true
      })
      return new Promise<NextEditResult>(() => {}) // never resolves
    }
    const ctrlA = new AbortController()
    const ctrlB = new AbortController()
    const a = cache.run('k', factory, ctrlA.signal)
    const b = cache.run('k', factory, ctrlB.signal)
    ctrlA.abort()
    expect(sharedAborted).toBe(false)
    ctrlB.abort()
    expect(sharedAborted).toBe(true)
    expect(await a).toEqual({ outcome: 'cancelled', edits: null })
    expect(await b).toEqual({ outcome: 'cancelled', edits: null })
  })

  // A flight whose last subscriber left is DOOMED: its controller is aborted and its only
  // possible result is `cancelled`. It stayed in the flights map until the factory got
  // around to settling, though, so a caller arriving in that window joined it and was told
  // its own request had been cancelled — a request nobody cancelled, answered by a
  // computation that was already dead. Single-flight must never hand out a doomed flight.
  it('does not join a flight whose last subscriber already left', async () => {
    const cache = createEditPredictionCache()
    let calls = 0
    const factory = (signal: AbortSignal) => {
      calls++
      return new Promise<NextEditResult>((resolve) => {
        // A realistic provider: it notices the abort, but only on a later tick.
        signal.addEventListener('abort', () => {
          setTimeout(() => resolve({ outcome: 'cancelled', edits: null }), 5)
        })
      })
    }

    const ctrl = new AbortController()
    const abandoned = cache.run('k', factory, ctrl.signal)
    ctrl.abort()
    expect(await abandoned).toEqual({ outcome: 'cancelled', edits: null })

    // Same fingerprint, brand-new caller, arriving before the dead factory settles.
    const fresh = await cache.run('k', async () => PREDICTED)
    expect(fresh).toEqual(PREDICTED)
    expect(calls).toBe(1) // the doomed flight was not reused, and not re-run either
    expect(cache.get('k')).toEqual(PREDICTED)
  })

  // With a doomed flight now removed eagerly, a NEW flight can be registered under the same
  // key while the old one is still settling. Its `finally` must not delete the newcomer.
  it('a settling old flight does not evict the flight that replaced it', async () => {
    const cache = createEditPredictionCache()
    const ctrl = new AbortController()
    let resolveOld!: (v: NextEditResult) => void
    void cache.run('k', () => new Promise<NextEditResult>((r) => (resolveOld = r)), ctrl.signal)
    ctrl.abort()

    let resolveNew!: (v: NextEditResult) => void
    const first = cache.run('k', () => new Promise<NextEditResult>((r) => (resolveNew = r)))
    // The old flight settles now — after the replacement was registered.
    resolveOld({ outcome: 'cancelled', edits: null })
    // Drain the microtask queue: the old flight's `.finally` sits behind its own `.then`,
    // so a single `await` is not enough for the unregister to have run.
    for (let i = 0; i < 8; i++) await Promise.resolve()

    // A second caller must still share the LIVE flight rather than starting a third compute.
    let secondFactoryRuns = 0
    const second = cache.run('k', async () => {
      secondFactoryRuns++
      return EMPTY
    })
    resolveNew(PREDICTED)
    expect(await first).toEqual(PREDICTED)
    expect(await second).toEqual(PREDICTED)
    expect(secondFactoryRuns).toBe(0)
  })

  it('an already-aborted caller gets cancelled and stays subscribed to shared work', async () => {
    const cache = createEditPredictionCache()
    const ctrl = new AbortController()
    ctrl.abort()
    const res = await cache.run('k', async () => PREDICTED, ctrl.signal)
    expect(res).toEqual({ outcome: 'cancelled', edits: null })
  })
})
