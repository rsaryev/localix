import { describe, expect, test } from 'bun:test'

import { createScriptVms } from './vm'

/**
 * A long-lived VM on the real QuickJS: it carries text both ways, makes no code of its own, and
 * whatever its code does — loop, allocate, throw — ends the VM or fails inside it, never the host.
 */
const vms = createScriptVms({ memoryLimitBytes: 16 * 1024 * 1024 })

/**
 * Starts a VM whose runtime evaluates each delivered message as a script (`host.evaluate`) and
 * posts its completion value back as JSON.
 */
function evaluator(sliceMs = 5_000) {
  const inbox: unknown[] = []
  const rejections: string[] = []
  let arrived = () => {}
  let exited!: (reason: string) => void
  const exit = new Promise<string>((resolve) => (exited = resolve))
  const vm = vms.start({
    name: 'evaluator.js',
    sliceMs,
    runtime: `
      host.listen((json) => {
        const source = JSON.parse(json)
        let value
        try {
          value = { ok: host.evaluate(source, 'message.js') }
        } catch (error) {
          value = { error: String(error) }
        }
        Promise.resolve(value.ok).then(
          (ok) => host.post(JSON.stringify(value.error ? value : { ok })),
          (error) => host.post(JSON.stringify({ rejected: String(error) })),
        )
      })
    `,
    onMessage(json) {
      inbox.push(JSON.parse(json))
      arrived()
    },
    onUnhandledRejection: (message) => void rejections.push(message),
    onExit: (reason) => exited(reason),
  })
  /** The answer to `source`, evaluated in the VM. */
  const ask = (source: string) =>
    new Promise<unknown>((resolve) => {
      arrived = () => resolve(inbox.shift())
      vm.send(JSON.stringify(source))
    })
  return { vm, ask, exit, rejections }
}

describe('a long-lived VM', () => {
  test('ends when one turn posts past its limits, before the host is swamped', async () => {
    for (const [loop, limit] of [
      ['for (;;) host.post("x")', 'messages'],
      ['for (;;) host.post("x".repeat(1000))', 'characters'],
    ] as const) {
      let received = 0
      let exited!: (reason: string) => void
      const exit = new Promise<string>((resolve) => (exited = resolve))
      vms
        .start({
          name: 'flood.js',
          sliceMs: 5_000,
          postLimits: { messages: 100, characters: 50_000 },
          runtime: `host.listen(() => { ${loop} })`,
          onMessage: () => void (received += 1),
          onExit: (reason) => exited(reason),
        })
        .send('"go"')
      expect(await exit).toContain(`more than`)
      expect(await exit).toContain(limit)
      expect(received).toBeLessThanOrEqual(100)
    }
  })

  test('keeps its state between messages and answers each', async () => {
    const { vm, ask } = evaluator()
    expect(await ask('globalThis.count = 1; count')).toEqual({ ok: 1 })
    expect(await ask('count += 1')).toEqual({ ok: 2 })
    expect(await ask('Promise.resolve(count * 10)')).toEqual({ ok: 20 })
    vm.stop()
  })

  test('makes no code at run time and imports nothing, while web APIs work', async () => {
    const { vm, ask } = evaluator()
    const probe = (expression: string) =>
      ask(`(() => { try { return typeof (${expression}) } catch (error) { return 'refused' } })()`)
    expect(await probe('eval')).toEqual({ ok: 'undefined' })
    expect(await probe(`Function('return this')`)).toEqual({ ok: 'refused' })
    expect(await probe(`(async function () {}).constructor('return 1')`)).toEqual({ ok: 'refused' })
    expect(await probe(`(function* () {}).constructor('yield 1')`)).toEqual({ ok: 'refused' })
    expect(await ask(`(() => {}) instanceof Function`)).toEqual({ ok: true })
    expect(await ask(`import('node:fs')`)).toMatchObject({
      rejected: expect.stringContaining('fs'),
    })
    expect(await ask(`typeof process + typeof Bun + typeof fetch + typeof require`)).toEqual({
      ok: 'undefinedundefinedundefinedundefined',
    })
    expect(
      await ask(`[
        new URL('/a?b=1', 'https://x.test').searchParams.get('b'),
        (() => {
          const url = new URL('https://x.test/?b=1')
          url.searchParams.set('c', '2')
          return url.href
        })(),
        new TextDecoder().decode(new TextEncoder().encode('é')),
        typeof crypto.subtle.digest,
        structuredClone({ at: [1] }).at[0],
        new Headers({ A: 'b' }).get('a'),
      ]`),
    ).toEqual({ ok: ['1', 'https://x.test/?b=1&c=2', 'é', 'function', 1, 'b'] })
    vm.stop()
  })

  test('freezes the built-ins, while code still assigns over what its own objects inherit', async () => {
    const { vm, ask } = evaluator()
    expect(
      await ask(`(() => {
        "use strict"
        try { Array.prototype.map = () => []; return 'changed' } catch { return 'refused' }
      })()`),
    ).toEqual({ ok: 'refused' })
    expect(
      await ask(
        `(() => { const list = [1]; list.push = (x) => 'pushed ' + x; return list.push(2) })()`,
      ),
    ).toEqual({ ok: 'pushed 2' })
    vm.stop()
  })

  test('an allocation past the memory limit fails inside the VM, which goes on', async () => {
    const { vm, ask } = evaluator()
    expect(
      await ask(`(() => {
        let list = []
        try { for (;;) list.push('x'.repeat(65536) + list.length) } catch (error) { list = null; return String(error) }
      })()`),
    ).toEqual({ ok: expect.stringMatching(/out of memory/) })
    expect(await ask('1 + 1')).toEqual({ ok: 2 })
    vm.stop()
  })

  test('a loop that never yields is interrupted at the turn limit, and the VM ends', async () => {
    const { ask, exit } = evaluator(200)
    void ask('for (;;) {}')
    expect(await exit).toBe('held its thread for 200 ms')
  })

  test('a loop of promise jobs is interrupted too', async () => {
    const { ask, exit } = evaluator(200)
    void ask('(async () => { for (;;) await null })()')
    expect(await exit).toBe('held its thread for 200 ms')
  })

  test('a rejection left unhandled at the end of a turn is reported; one handled later is not', async () => {
    const { vm, ask, rejections } = evaluator()
    await ask(`Promise.reject(new Error('dropped')); 1`)
    await ask(`const late = Promise.reject(new Error('handled')); late.catch(() => {}); 2`)
    expect(rejections).toEqual(['dropped'])
    vm.stop()
  })

  test('a job that throws ends the VM, naming the error', async () => {
    const { ask, exit } = evaluator()
    void ask(`queueMicrotask(() => { throw new Error('boom') }); 1`)
    expect(await exit).toBe('crashed: boom')
  })

  test('a VM whose QuickJS is missing ends at once, saying so', async () => {
    const reasons: string[] = []
    const broken = createScriptVms({ wasmPath: 'missing/quickjs.wasm' })
    const ended = new Promise<void>((resolve) =>
      broken.start({
        runtime: 'host.listen(() => {})',
        name: 'none.js',
        sliceMs: 1_000,
        onMessage: () => {},
        onExit(reason) {
          reasons.push(reason)
          resolve()
        },
      }),
    )
    await ended
    expect(reasons).toEqual([expect.stringContaining('could not load QuickJS')])
  })
})
