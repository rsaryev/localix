import { describe, expect, it, beforeEach } from 'bun:test'

import { useLiveTerminalsStore } from './liveTerminals'

// Regression (the "Terminal closed → Terminal" backwards flip on bash
// action:"open" cards): the live-PTY registry is poll-fed, so a PTY the agent
// JUST spawned was invisible until the next poll (up to 15s) — transcript cards
// read `ids.has(id) === false` and rendered a disabled "Terminal closed" action
// while the PTY was alive. `noteOpened` (driven by the `terminal.opened` push)
// seeds the id immediately, and `setIds` must not let a poll snapshot taken
// BEFORE the spawn wipe that seed.

const store = () => useLiveTerminalsStore.getState()

// Advance far past any optimistic TTL so seeds from a previous test expire.
let t = 0
beforeEach(() => {
  t += 1_000_000
  store().setIds([], t)
  expect(store().ids.size).toBe(0)
})

describe('liveTerminals optimistic seeding', () => {
  it('noteOpened marks the terminal live immediately', () => {
    store().noteOpened('pty-a', t)
    expect(store().ids.has('pty-a')).toBe(true)
  })

  it('noteFinished removes both a live id and its optimistic lease immediately', () => {
    store().noteOpened('pty-finished', t)
    expect(store().ids.has('pty-finished')).toBe(true)
    store().noteFinished('pty-finished')
    expect(store().ids.has('pty-finished')).toBe(false)

    // A stale empty poll must not resurrect the removed optimistic id.
    store().setIds([], t + 1)
    expect(store().ids.has('pty-finished')).toBe(false)
  })

  it('a stale poll (without the fresh id) does NOT wipe a just-seeded terminal', () => {
    store().noteOpened('pty-b', t)
    // Poll snapshot taken before the spawn — the old behavior replaced the set
    // and the card flipped to "Terminal closed" while the PTY was alive.
    store().setIds(['other'], t + 1_000)
    expect(store().ids.has('pty-b')).toBe(true)
    expect(store().ids.has('other')).toBe(true)
  })

  it('an expired seed is dropped by the next poll (a PTY that really died)', () => {
    store().noteOpened('pty-c', t)
    store().setIds([], t + 60_000)
    expect(store().ids.has('pty-c')).toBe(false)
  })

  it('once a poll confirms the id, the poll becomes authoritative (exit drops it)', () => {
    store().noteOpened('pty-d', t)
    store().setIds(['pty-d'], t + 1_000) // confirmed — optimistic seed cleared
    store().setIds([], t + 2_000) // PTY exited
    expect(store().ids.has('pty-d')).toBe(false)
  })
})
