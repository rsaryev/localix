import { describe, expect, test } from 'bun:test'
import type { AssistantMessage } from '@localixai/agent'
import { createModRunScope } from '../run-scope'
import { hostWithWorkers } from './testing-mods'

/** What a hooks module may reach from its worker, and how the host lives with a worker that dies. */

const PROBES = `
const probe = (reach) => {
  try {
    const got = reach()
    return got === undefined ? 'undefined' : typeof got
  } catch {
    return 'refused'
  }
}
export function register(on) {
  on('command.run', { command: 'probe' }, async ($) => ({
    text: JSON.stringify({
      process: probe(() => process),
      Bun: probe(() => Bun),
      fetch: probe(() => fetch),
      Worker: probe(() => Worker),
      setTimeout: probe(() => setTimeout),
      globalProcess: probe(() => globalThis.process),
      globalBun: probe(() => globalThis.Bun),
      selfFetch: probe(() => self.fetch),
      require: probe(() => require(['node', 'fs'].join(':'))),
      functionThis: probe(() => Function('return this')()),
      constructorThis: probe(() => (function () {}).constructor('return this')()),
      asyncConstructor: probe(() => (async function () {}).constructor('return 1')),
      eval: probe(() => (0, globalThis.eval)('1')),
      // A fresh realm, or compiled code, would have every global this one took away.
      shadowRealm: probe(() => new ShadowRealm().evaluate('typeof Bun')),
      globalShadowRealm: probe(() => globalThis.ShadowRealm),
      webAssembly: probe(() => WebAssembly),
      sharedArrayBuffer: probe(() => SharedArrayBuffer),
      atomics: probe(() => Atomics),
      buffer: probe(() => Buffer),
      messageChannel: probe(() => MessageChannel),
      postMessage: probe(() => postMessage),
      // What a mod may use: web APIs, and $.
      url: typeof URL,
      encoder: typeof TextEncoder,
      abort: typeof AbortController,
      subtle: typeof crypto.subtle,
      now: typeof (await $.clock.now()),
      isFunction: (() => {}) instanceof Function,
    }),
  }))
}
`

describe('a mod in its worker', () => {
  test('reaches no process, Bun, fetch, require, timers or code generation; $ and web APIs work', async () => {
    const { command, host, reports } = await hostWithWorkers({ probes: PROBES })
    expect(JSON.parse((await command('probes', 'probe')).text!)).toEqual({
      process: 'undefined',
      Bun: 'undefined',
      fetch: 'undefined',
      Worker: 'undefined',
      setTimeout: 'undefined',
      globalProcess: 'undefined',
      globalBun: 'undefined',
      selfFetch: 'undefined',
      require: 'refused',
      functionThis: 'refused',
      constructorThis: 'refused',
      asyncConstructor: 'refused',
      eval: 'refused',
      shadowRealm: 'refused',
      globalShadowRealm: 'undefined',
      webAssembly: 'undefined',
      sharedArrayBuffer: 'undefined',
      atomics: 'undefined',
      buffer: 'undefined',
      messageChannel: 'undefined',
      postMessage: 'undefined',
      url: 'function',
      encoder: 'function',
      abort: 'function',
      subtle: 'object',
      now: 'number',
      isFunction: true,
    })
    expect(reports).toEqual([])
    await host.stop()
  })

  test('a value carrying the reserved reference key fails its hook, and the host goes on', async () => {
    const { command, host, reports } = await hostWithWorkers({
      forger: `
        const KEY = String.fromCharCode(0) + 'lx'
        export function register(on) {
          on('command.run', { command: 'number' }, async () => ({ text: 'x', [KEY]: 5 }))
          on('command.run', { command: 'own' }, async () => ({ [KEY]: { own: 1 } }))
          on('command.run', { command: 'fine' }, async () => ({ text: 'fine' }))
        }
      `,
    })
    expect(await command('forger', 'number')).toEqual({})
    expect(await command('forger', 'own')).toEqual({})
    expect(await command('forger', 'fine')).toEqual({ text: 'fine' })
    expect(reports).toEqual([
      'forger: command.run: hook skipped: throw a value sent to or from a mod uses a reserved key',
      'forger: command.run: hook skipped: throw a value sent to or from a mod uses a reserved key',
    ])
    expect(host.instances().size).toBe(1)
    await host.stop()
  })

  test('a crash is reported, and the mod starts again, afresh, on its next event', async () => {
    const { command, host, reported, reports } = await hostWithWorkers({
      fragile: `
        let starts = 0
        let crashes = 0
        export function register(on) {
          on('session.start', async ($, e, next) => {
            starts += 1
            return next(e)
          })
          on('command.run', { command: 'count' }, async () => ({ text: starts + '/' + crashes }))
          on('command.run', { command: 'crash' }, async () => {
            crashes += 1
            queueMicrotask(() => {
              throw new Error('boom')
            })
            return { text: 'crashed ' + crashes }
          })
        }
      `,
    })
    expect(await command('fragile', 'count')).toEqual({ text: '1/0' })
    const crashed = reported('crashed')
    // The worker crashed before it could answer: the hook is skipped.
    expect(await command('fragile', 'crash')).toEqual({})
    expect(await crashed).toContain('fragile: the hooks module crashed: boom')
    expect(host.instances().size).toBe(0)
    // Started again by the next event: new module state, and session.start heard once more.
    expect(await command('fragile', 'count')).toEqual({ text: '1/0' })
    expect(host.failures()).toEqual(new Map())
    expect(reports).toEqual([
      'fragile: the hooks module crashed: boom; it starts again on its next event',
      'fragile: command.run: hook skipped: throw the hooks module crashed: boom',
    ])
    await host.stop()
  })

  test('streaming hooks read and yield across the boundary, and a closure answers a button', async () => {
    const { host, scene, logged } = await hostWithWorkers({
      relay: `
        let pressed = 0
        export function register(on) {
          on('session.start', async ($, e, next) => {
            await $.ui.open({ id: 'p' })
            return next(e)
          })
          on('ui.render', { component: 'Pane' }, async ($, e) => {
            const { Button } = $.ui.resolve(e)
            return Button({ key: 'b', label: 'Pressed ' + pressed, onPress: () => { pressed += 1 } })
          })
          on('turn.step', async function* ($, e, next) {
            const stream = next(e)
            const kinds = []
            for await (const chunk of stream) {
              kinds.push(chunk.kind)
              yield chunk
            }
            const result = await stream.result
            $.ui.log(kinds.join(',') + ' ' + result.answer)
            return result
          })
          on('turn.step', {}, async function* () {
            yield { kind: 'text', index: 0, text: 'Offline.' }
          })
        }
      `,
    })
    const scope = await createModRunScope(host, scene, new Set(['relay']), { model: 'model-a' })
    const message: AssistantMessage = await scope.modelStep('turn-1')!(
      { index: 0, modelId: 'model-a', messageCount: 1 },
      async () => {
        throw new Error('sent')
      },
    )
    expect(message.content).toEqual([{ type: 'text', text: 'Offline.' }])
    expect(logged).toEqual(['text Offline.'])

    const pane = [...host.instances().keys()][0]!
    expect((await host.panes.render(pane, 'p'))?.tree).toEqual([
      { type: 'Button', props: { key: 'b', label: 'Pressed 0' }, children: [] },
    ])
    expect(await host.panes.interact(pane, 'p', { kind: 'press', element: 'b' })).toBe(true)
    expect(JSON.stringify((await host.panes.render(pane, 'p'))?.tree)).toContain('Pressed 1')
    await host.stop()
  })
})
