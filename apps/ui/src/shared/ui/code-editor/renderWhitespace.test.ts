import { describe, expect, it } from 'bun:test'
import {
  getRenderWhitespace,
  setRenderWhitespace,
  subscribeRenderWhitespace,
} from './renderWhitespace'

describe('renderWhitespace preference', () => {
  it('set changes the value it reads back', () => {
    const start = getRenderWhitespace()
    setRenderWhitespace(!start)
    expect(getRenderWhitespace()).toBe(!start)
    setRenderWhitespace(start) // restore
  })

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const seen: boolean[] = []
    const off = subscribeRenderWhitespace((v) => seen.push(v))
    setRenderWhitespace(!getRenderWhitespace())
    off()
    setRenderWhitespace(!getRenderWhitespace())
    expect(seen.length).toBe(1)
  })

  it('is a no-op (no notification) when set to the current value', () => {
    let calls = 0
    const off = subscribeRenderWhitespace(() => calls++)
    setRenderWhitespace(getRenderWhitespace()) // same value
    off()
    expect(calls).toBe(0)
  })
})
