import { describe, expect, it } from 'bun:test'
import {
  getInlayHintsEnabled,
  setInlayHintsEnabled,
  toggleInlayHintsEnabled,
  subscribeInlayHintsEnabled,
} from './inlayHintsPref'

describe('inlayHints preference', () => {
  it('defaults on (parity with the original always-on behaviour)', () => {
    expect(getInlayHintsEnabled()).toBe(true)
  })

  it('toggle flips the current value and returns it', () => {
    const start = getInlayHintsEnabled()
    const next = toggleInlayHintsEnabled()
    expect(next).toBe(!start)
    expect(getInlayHintsEnabled()).toBe(next)
    toggleInlayHintsEnabled() // restore
  })

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const seen: boolean[] = []
    const off = subscribeInlayHintsEnabled((v) => seen.push(v))
    setInlayHintsEnabled(!getInlayHintsEnabled())
    off()
    setInlayHintsEnabled(!getInlayHintsEnabled())
    expect(seen.length).toBe(1)
    setInlayHintsEnabled(true) // restore default
  })

  it('is a no-op (no notification) when set to the current value', () => {
    let calls = 0
    const off = subscribeInlayHintsEnabled(() => calls++)
    setInlayHintsEnabled(getInlayHintsEnabled()) // same value
    off()
    expect(calls).toBe(0)
  })
})
