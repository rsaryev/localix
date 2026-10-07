import { describe, expect, test } from 'bun:test'
import { TerminalSession } from './session'
import type { PtyBackend } from './pty-backend'

// A backend whose handle exposes a `push` so a test can feed PTY output and an
// `exit` to end the job — enough to exercise served-URL detection.
function controllableBackend() {
  let dataCb: (d: string) => void = () => {}
  let exitCb: (c: number) => void = () => {}
  const backend: PtyBackend = {
    spawn() {
      return {
        write() {},
        resize() {},
        onData(cb) {
          dataCb = cb
        },
        onExit(cb) {
          exitCb = cb
        },
        kill() {},
      }
    },
  }
  return {
    backend,
    push: (d: string) => dataCb(d),
    exit: (c = 0) => exitCb(c),
  }
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
    command: 'npm run dev',
    chatSessionId: 'chat-1',
  })
}

describe('TerminalSession served-URL detection', () => {
  test('latches the first localhost URL advertised in output, onto info', () => {
    const { backend, push } = controllableBackend()
    const s = makeSession(backend)
    expect(s.info.previewUrl).toBeUndefined()
    push('VITE ready\n  ➜  Local:   http://localhost:5173/\n')
    expect(s.info.previewUrl).toBe('http://localhost:5173')
    // A later same-kind URL does NOT overwrite the latched one (tie keeps first).
    push('Network: http://localhost:9999/\n')
    expect(s.info.previewUrl).toBe('http://localhost:5173')
  })

  test('detects a URL split across two output chunks', () => {
    const { backend, push } = controllableBackend()
    const s = makeSession(backend)
    push('Local: http://localho')
    expect(s.info.previewUrl).toBeUndefined() // partial line not finalized → no latch
    push('st:3000/\n')
    expect(s.info.previewUrl).toBe('http://localhost:3000')
  })

  test('onPreviewUrl fires once on detection, and immediately for a late subscriber', () => {
    const { backend, push } = controllableBackend()
    const s = makeSession(backend)
    const early: string[] = []
    s.onPreviewUrl((u) => early.push(u))
    push('serving on http://127.0.0.1:8080/app\n')
    expect(early).toEqual(['http://127.0.0.1:8080/app'])
    // Subscribing after detection still gets the latched URL synchronously.
    const late: string[] = []
    s.onPreviewUrl((u) => late.push(u))
    expect(late).toEqual(['http://127.0.0.1:8080/app'])
  })

  test('no localhost URL → previewUrl stays undefined', () => {
    const { backend, push } = controllableBackend()
    const s = makeSession(backend)
    push('compiling...\nbuild complete in 1.2s\n')
    expect(s.info.previewUrl).toBeUndefined()
  })
})

describe('TerminalSession.screen (lazy VT emulator)', () => {
  test('retains the actual final grid when replay has discarded terminal modes', async () => {
    const { backend, push, exit } = controllableBackend()
    const s = makeSession(backend)
    try {
      push('\x1b[?7l\x1b[?1h') // no autowrap; application cursor mode
      await s.screen()
      push('X'.repeat(270_000)) // evicts those modes from replay
      const live = await s.screen()
      expect(live.text.split('\n')).toHaveLength(1)
      exit()
      expect(await s.screen()).toEqual(live)
    } finally {
      s.dispose()
    }
  })

  test('retains queued final output even when exit arrives before the parser drains', async () => {
    const { backend, push, exit } = controllableBackend()
    const s = makeSession(backend)
    try {
      push('\x1b[?7l')
      await s.screen()
      push('X'.repeat(270_000) + '\rDONE')
      exit()
      const final = await s.screen()
      expect(final.text.split('\n')).toHaveLength(1)
      expect(final.text).toStartWith('DONE')
      expect(await s.screen()).toEqual(final)
    } finally {
      s.dispose()
    }
  })

  // Regression: the emulator is built lazily, replaying the retained scrollback.
  // Because @xterm/headless parses asynchronously, the FIRST screen() used to
  // snapshot before that replay parsed → a blank grid for a live/full-screen app.
  test('first screen() reflects already-received output (not a blank replay)', async () => {
    const { backend, push } = controllableBackend()
    const s = makeSession(backend)
    push('$ echo hi\nhi\n')
    const snap = await s.screen()
    expect(snap.text).toContain('echo hi')
    expect(snap.text).toContain('hi')
  })

  test('reconstructs a full-screen TUI even when the scrollback lost the alt-enter', async () => {
    const { backend, push } = controllableBackend()
    const s = makeSession(backend)
    // A long-running TUI: it entered the alternate screen, then emitted only
    // incremental cursor-positioned updates. Simulate the byte-capped scrollback
    // having dropped the original DECSET 1049 — only the updates remain.
    push('\x1b[?1049h\x1b[2J\x1b[H') // enter alt + clear (altScreen now tracked true)
    push('\x1b[1;1HHEADER\x1b[24;1Hstatus bar')
    expect(s.info.altScreen).toBe(true)
    const snap = await s.screen()
    // Rendered on the alternate buffer, so the incremental paints land correctly.
    expect(snap.text.split('\n')[0]).toBe('HEADER')
    expect(snap.text).toContain('status bar')
  })

  test('live output after the first snapshot shows up in the next snapshot', async () => {
    const { backend, push } = controllableBackend()
    const s = makeSession(backend)
    push('first\n')
    expect((await s.screen()).text).toContain('first')
    push('second\n')
    expect((await s.screen()).text).toContain('second')
  })
})

describe('TerminalSession process settlement', () => {
  test('dispose settles exactly once when kill synchronously echoes a PTY exit', () => {
    let exitCallback: (code: number) => void = () => {}
    let kills = 0
    let cleanups = 0
    const lifecycle: number[] = []
    const listenerCodes: number[] = []
    const backend: PtyBackend = {
      spawn() {
        return {
          write() {},
          resize() {},
          onData() {},
          onExit(callback) {
            exitCallback = callback
          },
          kill() {
            kills += 1
            exitCallback(137)
          },
        }
      },
    }
    const session = new TerminalSession({
      id: 'settle-once',
      userId: 'u1',
      cwd: '/w',
      cols: 80,
      rows: 24,
      backend,
      cleanup: () => {
        cleanups += 1
      },
      onExit: (_id, code) => lifecycle.push(code),
    })
    session.onExit((code) => listenerCodes.push(code))

    session.dispose()
    session.dispose()
    exitCallback(0)

    expect(kills).toBe(1)
    expect(cleanups).toBe(1)
    expect(listenerCodes).toEqual([130])
    expect(lifecycle).toEqual([130])
  })

  test('a cleanup failure cannot strand the PTY or suppress server settlement', () => {
    let killed = false
    const lifecycle: number[] = []
    const backend: PtyBackend = {
      spawn() {
        return {
          write() {},
          resize() {},
          onData() {},
          onExit() {},
          kill() {
            killed = true
          },
        }
      },
    }
    const session = new TerminalSession({
      id: 'cleanup-failure',
      userId: 'u1',
      cwd: '/w',
      cols: 80,
      rows: 24,
      backend,
      cleanup: () => {
        throw new Error('temporary rc cleanup failed')
      },
      onExit: (_id, code) => lifecycle.push(code),
    })

    expect(() => session.dispose()).not.toThrow()
    expect(killed).toBe(true)
    expect(lifecycle).toEqual([130])
  })
})
