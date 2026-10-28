import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { installTestLocalStorage, removeTestLocalStorage } from '@localixai/kit/testing/dom'

import { composerBus, reloadComposerBusForTests, type ComposerInsert } from './composerBus'

describe('composerBus', () => {
  test('insert reaches every live subscriber; unsubscribe stops delivery', () => {
    const seen: string[] = []
    const offA = composerBus.subscribe((r) => {
      seen.push(`a:${r.text}`)
    })
    const offB = composerBus.subscribe((r) => {
      seen.push(`b:${r.text}`)
    })
    composerBus.insert({ sessionId: 's1', text: 'hi' })
    expect(seen).toEqual(['a:hi', 'b:hi'])

    offA()
    composerBus.insert({ sessionId: 's1', text: 'bye' })
    expect(seen).toEqual(['a:hi', 'b:hi', 'b:bye']) // 'a' unsubscribed
    offB() // clean up the singleton so tests don't bleed
  })

  test('a throwing subscriber does not block the others', () => {
    const seen: string[] = []
    const offBad = composerBus.subscribe(() => {
      throw new Error('boom')
    })
    const offGood = composerBus.subscribe((r) => {
      seen.push(r.text ?? '')
    })
    expect(() => composerBus.insert({ sessionId: 's1', text: 'ok' })).not.toThrow()
    expect(seen).toEqual(['ok'])
    offBad()
    offGood()
  })

  test('non-buffered insert with no subscriber is dropped', () => {
    composerBus.insert({ sessionId: 's1', text: 'lost' })
    const seen: string[] = []
    const off = composerBus.subscribe((r) => {
      seen.push(r.text ?? '')
    })
    expect(seen).toEqual([])
    off()
  })

  test('buffered insert is held until an accepting composer mounts', async () => {
    composerBus.insert({ text: 'later', sessionId: 's2', buffer: true })
    const seen: string[] = []
    // A composer for a DIFFERENT session declines — the insert stays pending.
    const offOther = composerBus.subscribe((r) =>
      r.sessionId && r.sessionId !== 's1' ? false : (seen.push(`s1:${r.text}`), true),
    )
    await Promise.resolve()
    expect(seen).toEqual([])
    // The addressed composer mounts and receives the held insert exactly once.
    const offTarget = composerBus.subscribe((r) =>
      r.sessionId && r.sessionId !== 's2' ? false : (seen.push(`s2:${r.text}`), true),
    )
    await Promise.resolve()
    expect(seen).toEqual(['s2:later'])
    offTarget()
    // Re-mounting must not replay it.
    const offAgain = composerBus.subscribe((r) => (seen.push(`again:${r.text}`), true))
    await Promise.resolve()
    expect(seen).toEqual(['s2:later'])
    offAgain()
    offOther()
  })

  test('every handler of the composer that mounts gets its share of a held insert', async () => {
    composerBus.insert({ text: 'both', sessionId: 's3', hold: true })
    const seen: string[] = []
    // One composer, two handlers subscribed one after the other (text, then context chips).
    const offText = composerBus.subscribe((r) => (seen.push(`text:${r.text}`), true))
    const offChips = composerBus.subscribe((r) => (seen.push(`chips:${r.text}`), true))
    await Promise.resolve()
    expect(seen).toEqual(['text:both', 'chips:both'])
    offText()
    offChips()
  })

  test('a held insert outlives the buffer window; a buffered one does not', async () => {
    const realNow = Date.now()
    composerBus.insert({ text: 'kept', sessionId: 's4', hold: true })
    composerBus.insert({ text: 'dropped', sessionId: 's4', buffer: true })
    const original = Date.now
    Date.now = () => realNow + 10 * 60_000
    try {
      const seen: string[] = []
      const off = composerBus.subscribe((r) => (seen.push(r.text ?? ''), true))
      await Promise.resolve()
      expect(seen).toEqual(['kept'])
      off()
    } finally {
      Date.now = original
    }
  })

  test('a session-addressed insert is applied immediately by a live matching composer', () => {
    const seen: string[] = []
    const off = composerBus.subscribe((r) =>
      r.sessionId && r.sessionId !== 's9' ? false : (seen.push(r.text ?? ''), true),
    )
    composerBus.insert({ text: 'now', sessionId: 's9', buffer: true })
    expect(seen).toEqual(['now'])
    off()
    // Applied — nothing pending for the next subscriber.
    const seenLate: string[] = []
    const offLate = composerBus.subscribe((r) => (seenLate.push(r.text ?? ''), true))
    expect(seenLate).toEqual([])
    offLate()
  })
})

describe('composerBus held inserts across a reload', () => {
  let store: Map<string, string>
  beforeEach(() => {
    store = new Map()
    installTestLocalStorage({
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    })
    reloadComposerBusForTests()
  })
  afterEach(() => {
    reloadComposerBusForTests()
    removeTestLocalStorage()
  })

  const chip = {
    kind: 'context' as const,
    id: 'chip-1',
    resolution: { status: 'resolved' as const, contributions: [] },
    source: 'drag' as const,
    target: { kind: 'file', token: '@src/app.ts', label: 'app.ts' },
  }

  async function open(sessionId: string): Promise<ComposerInsert[]> {
    const seen: ComposerInsert[] = []
    const off = composerBus.subscribe((req) =>
      req.sessionId === sessionId ? (seen.push(req), true) : false,
    )
    await Promise.resolve()
    off()
    return seen
  }

  test('a held insert nobody took survives a reload, whole, and is delivered once', async () => {
    composerBus.insert({
      sessionId: 'child',
      text: 'first\n\nsecond',
      bindings: [chip],
      hold: true,
    })
    reloadComposerBusForTests()

    const delivered = await open('child')
    expect(delivered).toHaveLength(1)
    expect(delivered[0]!.text).toBe('first\n\nsecond')
    expect(delivered[0]!.bindings).toEqual([chip])

    reloadComposerBusForTests()
    expect(await open('child')).toEqual([])
  })

  test('a held insert is not replayed to another session, and waits for its own after a reload', async () => {
    composerBus.insert({ sessionId: 'child', text: 'mine', hold: true })
    reloadComposerBusForTests()
    expect(await open('other')).toEqual([])
    reloadComposerBusForTests()
    expect((await open('child')).map((req) => req.text)).toEqual(['mine'])
  })

  test('an insert a live composer took is not kept for the next reload', async () => {
    const off = composerBus.subscribe(() => true)
    composerBus.insert({ sessionId: 'child', text: 'taken', hold: true })
    off()
    reloadComposerBusForTests()
    expect(await open('child')).toEqual([])
  })

  test('a retracted chip leaves nothing behind for the next reload', async () => {
    composerBus.insert({ sessionId: 'child', bindings: [chip], hold: true })
    composerBus.retract({ sessionId: 'child', tokens: ['@src/app.ts'] })
    reloadComposerBusForTests()
    expect(await open('child')).toEqual([])
  })

  test('a buffered insert is not persisted', async () => {
    composerBus.insert({ sessionId: 'child', text: 'short-lived', buffer: true })
    reloadComposerBusForTests()
    expect(await open('child')).toEqual([])
  })

  test('unreadable or unwritable storage never breaks an insert', async () => {
    installTestLocalStorage({
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('full')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    })
    reloadComposerBusForTests()
    expect(() => composerBus.insert({ sessionId: 'child', text: 'kept', hold: true })).not.toThrow()
    expect((await open('child')).map((req) => req.text)).toEqual(['kept'])
  })
})
