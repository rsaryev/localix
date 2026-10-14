import { describe, expect, test } from 'bun:test'

import { composerBus } from './composerBus'

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

  test('buffered insert is held until an accepting composer mounts', () => {
    composerBus.insert({ text: 'later', sessionId: 's2', buffer: true })
    const seen: string[] = []
    // A composer for a DIFFERENT session declines — the insert stays pending.
    const offOther = composerBus.subscribe((r) =>
      r.sessionId && r.sessionId !== 's1' ? false : (seen.push(`s1:${r.text}`), true),
    )
    expect(seen).toEqual([])
    // The addressed composer mounts and receives the held insert exactly once.
    const offTarget = composerBus.subscribe((r) =>
      r.sessionId && r.sessionId !== 's2' ? false : (seen.push(`s2:${r.text}`), true),
    )
    expect(seen).toEqual(['s2:later'])
    offTarget()
    // Re-mounting must not replay it.
    const offAgain = composerBus.subscribe((r) => (seen.push(`again:${r.text}`), true))
    expect(seen).toEqual(['s2:later'])
    offAgain()
    offOther()
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
