/**
 * Who owns the models folder's router, decided over its claim file, with the processes faked:
 * which pids are alive, whether a claimed router answers to its key, what was reaped, and the
 * idle timer. router-shared.integration.test.ts runs the same rules with real processes.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import { installPaths } from './installer'
import type { LlamaServer } from './llama-server'
import { createModelRouter } from './router'

const dir = tempDirPerTest('router-shared-')

/** One machine: a models folder, the pids alive on it, and what was reaped or probed there. */
function machine() {
  const root = dir()
  const alive = new Set<number>()
  const reaped: number[] = []
  const answering = new Set<number>()
  let now = 0
  let waited: () => void = () => undefined
  /** Settles once some API waits on the launch lock another one holds. */
  const lockWait = new Promise<void>((resolve) => (waited = resolve))
  const timers: Array<{ run: () => unknown; at: number; cancelled: boolean }> = []
  return {
    root,
    alive,
    reaped,
    answering,
    timers,
    lockWait,
    setNow: (at: number) => (now = at),
    /** Run the idle timers due by `at`, as the clock reaching it would. */
    async advance(at: number) {
      now = at
      const due = timers.splice(0).filter((timer) => {
        if (timer.at > at && !timer.cancelled) timers.push(timer)
        return timer.at <= at && !timer.cancelled
      })
      for (const timer of due) await timer.run()
    },
    claim: () =>
      JSON.parse(readFileSync(path.join(root, 'router', 'router.json'), 'utf8')) as {
        routerPid: number
        ownerPid: number
      },
    /** An API process on this machine, with pid `self`, whose router starts as `routerPid`. */
    api(self: number, routerPid: number, idleMs = 60_000) {
      alive.add(self)
      const counts = { starts: 0, stops: 0 }
      let release: (() => void) | null = null
      let hold: Promise<void> | null = null
      let startCalled: (() => void) | null = null
      const router = createModelRouter({
        paths: installPaths(root),
        executable: async () => '/bin/llama-server',
        models: async () => [],
        idleMs,
        start: async () => {
          counts.starts += 1
          startCalled?.()
          if (hold) await hold
          alive.add(routerPid)
          answering.add(routerPid)
          const server: LlamaServer = {
            pid: routerPid,
            baseUrl: `http://127.0.0.1:${routerPid}`,
            apiKey: `key-${routerPid}`,
            get running() {
              return alive.has(routerPid)
            },
            request: async () => new Response('{}'),
            stop: async () => {
              counts.stops += 1
              alive.delete(routerPid)
            },
          }
          return server
        },
        shared: {
          self,
          isAlive: (pid) => alive.has(pid),
          reap: async (pid) => {
            reaped.push(pid)
            alive.delete(pid)
            return true
          },
          probe: async (claim) => answering.has(claim.routerPid),
          now: () => now,
          schedule: (run, ms) => {
            const timer = { run, at: now + ms, cancelled: false }
            timers.push(timer)
            return () => void (timer.cancelled = true)
          },
          pause: () => {
            waited()
            return new Promise((resolve) => setTimeout(resolve, 0))
          },
        },
      })
      return {
        router,
        counts,
        /**
         * Hold this API's next router start: `started` settles once the start is under way (the
         * launch lock is held by then), and `release` lets it finish.
         */
        holdStart() {
          hold = new Promise((resolve) => (release = resolve))
          const started = new Promise<void>((resolve) => (startCalled = resolve))
          return { started, release: () => release?.() }
        },
      }
    },
  }
}

describe('one router per models folder', () => {
  test('a second API uses the router the first one started, and its stop leaves it running', async () => {
    const m = machine()
    const a = m.api(100, 500)
    const b = m.api(200, 600)
    const first = await a.router.ensure()
    const second = await b.router.ensure()
    expect(second).toMatchObject({ pid: 500, baseUrl: first.baseUrl, apiKey: first.apiKey })
    expect(b.counts.starts).toBe(0)

    await b.router.stop()
    expect(a.counts.stops).toBe(0)
    expect(m.alive.has(500)).toBe(true)
    expect(m.claim()).toMatchObject({ routerPid: 500, ownerPid: 100 })
  })

  test('two APIs starting at the same moment start one router', async () => {
    const m = machine()
    const a = m.api(100, 500)
    const b = m.api(200, 600)
    const held = a.holdStart()
    const first = a.router.ensure()
    await held.started
    const second = b.router.ensure()
    await m.lockWait
    held.release()
    expect((await first).pid).toBe(500)
    expect((await second).pid).toBe(500)
    expect(a.counts.starts + b.counts.starts).toBe(1)
  })

  test('a router whose API is gone is reaped and replaced', async () => {
    const m = machine()
    await m.api(100, 500).router.ensure()
    m.alive.delete(100)
    const b = m.api(200, 600)
    expect((await b.router.ensure()).pid).toBe(600)
    expect(m.reaped).toEqual([500])
    expect(m.claim()).toMatchObject({ routerPid: 600, ownerPid: 200 })
  })

  test('a live API’s router that does not answer to its key is left alone, not killed', async () => {
    const m = machine()
    await m.api(100, 500).router.ensure()
    m.answering.delete(500)
    const b = m.api(200, 600)
    expect((await b.router.ensure()).pid).toBe(600)
    expect(m.reaped).toEqual([])
    expect(m.alive.has(500)).toBe(true)
  })

  test('when the owner dies, the API that used its router starts its own on the next request', async () => {
    const m = machine()
    await m.api(100, 500).router.ensure()
    const b = m.api(200, 600)
    expect((await b.router.ensure()).pid).toBe(500)
    m.alive.delete(100)
    expect((await b.router.ensure()).pid).toBe(600)
    expect(m.claim()).toMatchObject({ routerPid: 600, ownerPid: 200 })
  })

  test('an owner’s stop clears the claim only while the claim is still its own', async () => {
    const m = machine()
    const a = m.api(100, 500)
    await a.router.ensure()
    m.answering.delete(500)
    await m.api(200, 600).router.ensure()
    await a.router.stop()
    expect(m.claim()).toMatchObject({ routerPid: 600, ownerPid: 200 })

    const c = m.api(300, 700)
    expect((await c.router.ensure()).pid).toBe(600)
  })

  test('the owner keeps its router while another API is still using it', async () => {
    const m = machine()
    const a = m.api(100, 500, 1_000)
    const b = m.api(200, 600, 1_000)
    await a.router.ensure()
    m.setNow(800)
    await b.router.ensure()

    await m.advance(1_000)
    expect(a.counts.stops).toBe(0)
    await m.advance(1_900)
    expect(a.counts.stops).toBe(1)
    expect(existsSync(path.join(m.root, 'router', 'router.json'))).toBe(false)
  })

  test('the API restarting under the same pid replaces the router it recorded', async () => {
    const m = machine()
    await m.api(100, 500).router.ensure()
    const again = m.api(100, 600)
    expect((await again.router.ensure()).pid).toBe(600)
    expect(m.reaped).toEqual([500])
  })

  test('boot reaps a router nobody owns and leaves a live API’s router running', async () => {
    const m = machine()
    await m.api(100, 500).router.ensure()
    const b = m.api(200, 600)
    await b.router.reapStale()
    expect(m.reaped).toEqual([])
    m.alive.delete(100)
    await b.router.reapStale()
    expect(m.reaped).toEqual([500])
  })

  test('a launch lock left by a dead process does not block a start', async () => {
    const m = machine()
    mkdirSync(path.join(m.root, 'router'), { recursive: true })
    writeFileSync(path.join(m.root, 'router', 'launch.lock'), '999')
    expect((await m.api(100, 500).router.ensure()).pid).toBe(500)
    expect(existsSync(path.join(m.root, 'router', 'launch.lock'))).toBe(false)
  })
})
