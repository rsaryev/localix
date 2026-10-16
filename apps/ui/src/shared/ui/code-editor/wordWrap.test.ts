import { describe, expect, it } from 'bun:test'
import { getWordWrap, setWordWrap, toggleWordWrap, subscribeWordWrap } from './wordWrap'

describe('wordWrap preference', () => {
  it('toggle flips the current value and returns it', () => {
    const start = getWordWrap()
    const next = toggleWordWrap()
    expect(next).toBe(!start)
    expect(getWordWrap()).toBe(next)
    toggleWordWrap() // restore
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
