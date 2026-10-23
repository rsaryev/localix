import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'

import { describe, expect, test } from 'bun:test'

import { awaitBunChildGone, awaitChildGone, type BunChild } from './child-exit'

function fakeNodeChild(): EventEmitter & ChildProcess {
  return new EventEmitter() as EventEmitter & ChildProcess
}

describe('awaitChildGone', () => {
  test('close wins the exit drain and all terminal listeners are released', async () => {
    const child = fakeNodeChild()
    let exits = 0
    const gone = awaitChildGone(child, { drainMs: 60_000, onExit: () => exits++ })

    child.emit('exit', 0, null)
    child.emit('close', 0, null)

    expect(await gone).toEqual({ code: 0, viaExit: false })
    expect(exits).toBe(1)
    expect({
      close: child.listenerCount('close'),
      error: child.listenerCount('error'),
      exit: child.listenerCount('exit'),
    }).toEqual({ close: 0, error: 0, exit: 0 })
  })

  test('a spawn error settles exactly once and a later exit has no side effects', async () => {
    const child = fakeNodeChild()
    const error = new Error('spawn failed')
    let exits = 0
    const gone = awaitChildGone(child, { onExit: () => exits++ })

    child.emit('error', error)
    child.emit('exit', 1, null)
    child.emit('close', 1, null)

    expect(await gone).toEqual({ code: null, error, viaExit: false })
    expect(exits).toBe(0)
    expect(child.eventNames()).toEqual([])
  })

  test('a close-first permutation cannot run the exit callback afterwards', async () => {
    const child = fakeNodeChild()
    let exits = 0
    const gone = awaitChildGone(child, { onExit: () => exits++ })

    child.emit('close', 23, null)
    child.emit('exit', 23, null)

    expect(await gone).toEqual({ code: 23, viaExit: false })
    expect(exits).toBe(0)
    expect(child.eventNames()).toEqual([])
  })
})

/**
 * `awaitBunChildGone` — the Bun-shaped teardown, with the SIGTERM → wait → SIGKILL escalation
 * INSIDE it.
 *
 * The escalation is the part every hand-rolled copy gets subtly different, so it is pinned
 * here as behaviour rather than left to each caller's good intentions. A fake child is enough
 * (and is what the workbench backends' own tests inject), because the claim is about the
 * SEQUENCE of signals and the SHAPE of the wait, not about the kernel.
 */

/** A `Bun.spawn` stand-in whose death we script. */
function fakeChild(
  opts: { diesOn?: 'SIGTERM' | 'SIGKILL' | 'never'; delayMs?: number } = {},
): BunChild & {
  signals: string[]
} {
  const diesOn = opts.diesOn ?? 'SIGTERM'
  const signals: string[] = []
  let settle: (code: number) => void = () => {}
  const exited = new Promise<number>((r) => {
    settle = r
  })
  return {
    signals,
    exited,
    kill(signal?: NodeJS.Signals | number) {
      const s = String(signal ?? 'SIGTERM')
      signals.push(s)
      if (diesOn === 'never') return
      if (s === diesOn || (diesOn === 'SIGTERM' && s === 'SIGKILL')) {
        setTimeout(() => settle(0), opts.delayMs ?? 0)
      }
    },
  }
}

describe('awaitBunChildGone', () => {
  test('sends SIGTERM first, and resolves true when that is enough', async () => {
    const child = fakeChild({ diesOn: 'SIGTERM' })
    expect(await awaitBunChildGone(child)).toBe(true)
    expect(child.signals).toEqual(['SIGTERM'])
  })

  test('ESCALATES to SIGKILL when the child ignores SIGTERM — and keeps waiting for the exit', async () => {
    // The bug in every copy: `proc.kill()` returns at once, the registry entry is dropped, and
    // the caller believes the port is free while the child is still alive. This must NOT
    // resolve until the child is actually gone.
    const child = fakeChild({ diesOn: 'SIGKILL' })
    let resolved = false
    const gone = awaitBunChildGone(child, { timeoutMs: 10 }).then((r) => {
      resolved = true
      return r
    })

    expect(resolved).toBe(false) // still waiting out the grace window
    expect(await gone).toBe(false) // false = it had to be escalated
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL'])
  })

  test('a polite child that exits DURING the grace window is never SIGKILLed', async () => {
    const child = fakeChild({ diesOn: 'SIGTERM', delayMs: 5 })
    expect(await awaitBunChildGone(child, { timeoutMs: 200 })).toBe(true)
    expect(child.signals).toEqual(['SIGTERM'])
  })

  test('signal: SIGKILL skips the escalation — there is nothing to escalate to', async () => {
    const child = fakeChild({ diesOn: 'SIGKILL' })
    expect(await awaitBunChildGone(child, { signal: 'SIGKILL' })).toBe(true)
    expect(child.signals).toEqual(['SIGKILL'])
  })

  test('an already-reaped child is a SUCCESS, not an error (kill may throw ESRCH)', async () => {
    const child: BunChild = {
      exited: Promise.resolve(0),
      kill() {
        throw new Error('ESRCH: no such process')
      },
    }
    expect(await awaitBunChildGone(child)).toBe(true)
  })

  test('a child that never dies at all still settles once SIGKILL lands (the wait is bounded by the exit, not by us)', async () => {
    // `.exited` is the ONLY authority on "gone". A copy that resolves on its own timer would
    // report a corpse that is still holding the port.
    let settle: (code: number) => void = () => {}
    const child: BunChild & { signals: string[] } = {
      signals: [],
      exited: new Promise<number>((r) => {
        settle = r
      }),
      kill(signal?: NodeJS.Signals | number) {
        this.signals.push(String(signal ?? 'SIGTERM'))
      },
    }

    let resolved = false
    const gone = awaitBunChildGone(child, { timeoutMs: 5 }).then((r) => {
      resolved = true
      return r
    })

    await Bun.sleep(40)
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(resolved).toBe(false) // escalated, but the child has not been reaped — still waiting

    settle(137)
    expect(await gone).toBe(false)
  })
})
