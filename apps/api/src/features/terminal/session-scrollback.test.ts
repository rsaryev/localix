import { describe, expect, test } from 'bun:test'
import { TerminalSession } from './session'
import type { PtyBackend } from './pty-backend'

/**
 * The retained scrollback is what a reconnecting client repaints, so changing HOW it is
 * retained must not change WHAT it retains. It used to be one string rebuilt per PTY
 * chunk (`(scrollback + data).slice(-LIMIT)`); it is now a chunk ring trimmed by code
 * units and joined on read. These pin the two properties that made the old form
 * observable: the exact cap, and the mid-chunk cut at the boundary.
 */
const LIMIT = 256 * 1024

function controllableBackend() {
  let dataCb: (d: string) => void = () => {}
  const backend: PtyBackend = {
    spawn() {
      return {
        write() {},
        resize() {},
        onData(cb) {
          dataCb = cb
        },
        onExit() {},
        kill() {},
      }
    },
  }
  return { backend, push: (d: string) => dataCb(d) }
}

function makeSession(backend: PtyBackend) {
  return new TerminalSession({
    id: 't1',
    userId: 'u1',
    cwd: '/w',
    cols: 80,
    rows: 24,
    backend,
    onExit: () => {},
  })
}

describe('TerminalSession scrollback retention', () => {
  test('under the cap, replay is every byte in arrival order', () => {
    const { backend, push } = controllableBackend()
    const s = makeSession(backend)
    for (const part of ['alpha\n', 'beta\n', 'gamma\n']) push(part)
    expect(s.replay).toBe('alpha\nbeta\ngamma\n')
  })

  test('over the cap, replay is exactly the last LIMIT code units', () => {
    const { backend, push } = controllableBackend()
    const s = makeSession(backend)
    // Chunks that do NOT divide the cap, so the boundary lands mid-chunk and the
    // oldest survivor has to be cut — the case a whole-chunk eviction gets wrong.
    const chunk = 'abcdefg'.repeat(13) // 91 bytes, the measured median PTY chunk
    const written: string[] = []
    for (let i = 0; i < Math.ceil((LIMIT * 1.5) / chunk.length); i++) {
      push(chunk)
      written.push(chunk)
    }
    const expected = written.join('').slice(-LIMIT)
    expect(s.replay).toHaveLength(LIMIT)
    expect(s.replay).toBe(expected)
  })

  test('replay stays correct when read repeatedly between chunks (join is memoized, not stale)', () => {
    const { backend, push } = controllableBackend()
    const s = makeSession(backend)
    push('one')
    expect(s.replay).toBe('one')
    expect(s.replay).toBe('one') // second read must not re-join into something else
    push('-two')
    expect(s.replay).toBe('one-two') // ...and a new chunk must invalidate it
  })

  test('a single chunk larger than the cap is itself trimmed to the cap', () => {
    const { backend, push } = controllableBackend()
    const s = makeSession(backend)
    const huge = 'z'.repeat(LIMIT + 1000)
    push(huge)
    expect(s.replay).toHaveLength(LIMIT)
    expect(s.replay).toBe(huge.slice(-LIMIT))
  })
})
