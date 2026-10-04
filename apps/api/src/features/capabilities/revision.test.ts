import { afterEach, describe, expect, test } from 'bun:test'

import {
  __resetCapabilityRevision,
  bootCapabilityRevision,
  bumpCapabilityRevision,
  capabilityRevision,
} from './revision'

afterEach(() => __resetCapabilityRevision())

type RevisionModule = { capabilityRevision: typeof capabilityRevision }

/**
 * The client's rule, as `enabledPlugins.ts` and `capabilityCache.ts` apply it: an answer whose
 * revision is LOWER than the one already held is an out-of-order reply and is dropped.
 */
const clientAccepts = (held: number, answer: number) => !(answer < held)

describe('capability revision across an API restart', () => {
  // The counter started at 0 in every process, so a client that outlived a restart held a
  // higher number than anything the new process said and dropped every toggle's answer.
  test('a fresh process starts at its boot epoch, not 0', async () => {
    const before = Date.now()
    // A cache-busting specifier loads a NEW module instance — a new process, as far as the
    // module-level counter is concerned.
    const fresh = (await import(`./revision.ts?boot=${before}`)) as RevisionModule
    expect(fresh.capabilityRevision()).toBeGreaterThanOrEqual(before)
    expect(fresh.capabilityRevision()).toBeLessThanOrEqual(Date.now())
  })

  test('the restarted process answers at or above what the old one handed out', () => {
    const bootedAt = 1_800_000_000_000
    __resetCapabilityRevision(bootCapabilityRevision(bootedAt))
    for (let i = 0; i < 5; i++) bumpCapabilityRevision()
    const held = capabilityRevision() // what the client converged to before the restart

    // The sidecar restarts a minute later; the client keeps its document.
    __resetCapabilityRevision(bootCapabilityRevision(bootedAt + 60_000))
    expect(clientAccepts(held, capabilityRevision())).toBe(true)
    bumpCapabilityRevision() // the first toggle after the restart
    expect(clientAccepts(held, capabilityRevision())).toBe(true)
  })

  test('without the epoch the same restart is dropped (the regression)', () => {
    __resetCapabilityRevision(0)
    for (let i = 0; i < 5; i++) bumpCapabilityRevision()
    const held = capabilityRevision()
    __resetCapabilityRevision(0) // the old seed
    bumpCapabilityRevision()
    expect(clientAccepts(held, capabilityRevision())).toBe(false)
  })

  test('the seed is an integer the snapshot contract accepts', () => {
    expect(Number.isSafeInteger(bootCapabilityRevision(1_800_000_000_000.7))).toBe(true)
    expect(bootCapabilityRevision(-5)).toBe(0)
  })
})
