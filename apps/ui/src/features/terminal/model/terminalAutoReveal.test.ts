import { describe, expect, test } from 'bun:test'
import { decideAutoReveal } from './terminalAutoReveal'

const none = () => false
const all = () => true

describe('decideAutoReveal', () => {
  test('alt-screen enter edge on a tab-less PTY → reveal', () => {
    const prev = new Map([['t1', false]])
    const d = decideAutoReveal(prev, [{ id: 't1', altScreen: true }], none)
    expect(d.reveal).toEqual(['t1'])
    expect(d.next.get('t1')).toBe(true)
  })

  test('first sight already on the alt screen (post-reload) → reveal', () => {
    const d = decideAutoReveal(new Map(), [{ id: 't1', altScreen: true }], none)
    expect(d.reveal).toEqual(['t1'])
  })

  test('steady alt-screen state does NOT re-reveal (closing the tab is respected)', () => {
    const prev = new Map([['t1', true]])
    const d = decideAutoReveal(prev, [{ id: 't1', altScreen: true }], none)
    expect(d.reveal).toEqual([])
  })

  test('leave then re-enter reveals again', () => {
    let prev: Map<string, boolean> = new Map([['t1', true]])
    prev = decideAutoReveal(prev, [{ id: 't1', altScreen: false }], none).next
    const d = decideAutoReveal(prev, [{ id: 't1', altScreen: true }], none)
    expect(d.reveal).toEqual(['t1'])
  })

  test('a PTY with an open tab is never in the reveal list', () => {
    const d = decideAutoReveal(new Map(), [{ id: 't1', altScreen: true }], all)
    expect(d.reveal).toEqual([])
    expect(d.next.get('t1')).toBe(true) // still observed → no later phantom edge
  })

  test('plain alive shells (no alt screen) are never revealed', () => {
    const d = decideAutoReveal(new Map(), [{ id: 't1', altScreen: false }], none)
    expect(d.reveal).toEqual([])
  })

  test('dead PTYs drop out of the next observation state', () => {
    const prev = new Map([
      ['gone', true],
      ['t1', false],
    ])
    const d = decideAutoReveal(prev, [{ id: 't1', altScreen: false }], none)
    expect([...d.next.keys()]).toEqual(['t1'])
  })

  test('multiple edges reveal in observation order', () => {
    const d = decideAutoReveal(
      new Map(),
      [
        { id: 'a', altScreen: true },
        { id: 'b', altScreen: false },
        { id: 'c', altScreen: true },
      ],
      none,
    )
    expect(d.reveal).toEqual(['a', 'c'])
  })
})
