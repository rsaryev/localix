import { describe, expect, it } from 'bun:test'
import { getWordWrap, setWordWrap, subscribeWordWrap } from './wordWrap'

describe('wordWrap preference', () => {
  it('set changes the value it reads back', () => {
    const start = getWordWrap()
    setWordWrap(!start)
    expect(getWordWrap()).toBe(!start)
    setWordWrap(start) // restore
  })

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const seen: boolean[] = []
    const off = subscribeWordWrap((v) => seen.push(v))
    setWordWrap(!getWordWrap())
    off()
    setWordWrap(!getWordWrap())
    expect(seen.length).toBe(1)
  })

  it('is a no-op (no notification) when set to the current value', () => {
    let calls = 0
    const off = subscribeWordWrap(() => calls++)
    setWordWrap(getWordWrap()) // same value
    off()
    expect(calls).toBe(0)
  })
})
