import { describe, it, expect, beforeAll, afterAll } from 'bun:test'

// The badge goes through the shell's `set_badge` command (`window.__TAURI__.core.invoke`), looked
// up lazily on every call. Module state (the dedup `lastCount`) is shared across the tests in this
// file, so ordering is deterministic and asserted explicitly.

const calls: { command: string; args: unknown }[] = []
const core = {
  invoke: (command: string, args?: unknown) => {
    calls.push({ command, args })
    return Promise.resolve()
  },
}

let setDesktopBadge: (n: number) => void

beforeAll(async () => {
  ;(globalThis as unknown as { window: unknown }).window = { __TAURI__: { core } }
  ;({ setDesktopBadge } = await import('./desktopBadge'))
})

// bun runs every test FILE in one process with a shared module cache: a stub `window` left behind
// here is the `window` the next file's modules see at import time.
afterAll(() => {
  delete (globalThis as unknown as { window?: unknown }).window
})

const counts = () => calls.filter((call) => call.command === 'set_badge').map((call) => call.args)

describe('setDesktopBadge', () => {
  it('sets the count, clears on 0, and dedups unchanged values', async () => {
    setDesktopBadge(3) // → 3
    setDesktopBadge(3) // unchanged → deduped, no native call
    setDesktopBadge(0) // clears
    setDesktopBadge(-2) // <= 0 → 0, already 0 → deduped
    await Promise.resolve()

    expect(counts()).toEqual([{ count: 3 }, { count: 0 }])
  })

  it('no-ops without the shell bridge, and still writes the count once the bridge appears', () => {
    const win = (globalThis as unknown as { window: { __TAURI__: unknown } }).window
    win.__TAURI__ = {}
    try {
      const before = counts().length
      expect(() => setDesktopBadge(7)).not.toThrow()
      expect(counts().length).toBe(before)
    } finally {
      win.__TAURI__ = { core }
    }
    setDesktopBadge(7)
    expect(counts().at(-1)).toEqual({ count: 7 })
  })
})
