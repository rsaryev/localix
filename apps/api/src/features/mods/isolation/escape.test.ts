import { describe, expect, test } from 'bun:test'
import { createScriptVms } from '@localixai/engine-scripts'
import { hostWithVms } from './testing-mods'

/**
 * What a hooks module can change in its VM: nothing the runtime it shares the VM with relies on.
 * Every built-in is frozen before the module runs, so a module cannot make the runtime's encoding,
 * promises or console lie to the host; its own objects still assign over what they inherit.
 */

const vms = createScriptVms()

const ESCAPE = `
const attempt = (change) => {
  try {
    change()
    return 'changed'
  } catch {
    return 'refused'
  }
}
export function register(on) {
  on('command.run', { command: 'redefine' }, async () => ({
    text: JSON.stringify({
      objectThen: attempt(() =>
        Object.defineProperty(Object.prototype, 'then', { get: () => 'mine' }),
      ),
      stringify: attempt(() => {
        JSON.stringify = () => '{}'
      }),
      map: attempt(() => {
        Array.prototype.map = () => []
      }),
      iterator: attempt(() => {
        Object.getPrototypeOf([][Symbol.iterator]()).next = () => ({ done: true })
      }),
      promise: attempt(() => {
        Promise.prototype.then = () => {}
      }),
      console: attempt(() => {
        console.log = () => {}
      }),
      runtime: attempt(() => {
        globalThis[Symbol.for('localix.mods.claude-code')].h = () => null
      }),
    }),
  }))
  on('command.run', { command: 'still' }, async () => ({ text: [1, 2].map((n) => n * 2).join() }))
}
`

describe('a mod changing what its VM relies on', () => {
  test('cannot redefine Object.prototype, JSON, the intrinsics, console or the runtime', async () => {
    const { command, host, reports } = await hostWithVms({ escape: ESCAPE }, { vms })
    expect(JSON.parse((await command('escape', 'redefine')).text!)).toEqual({
      objectThen: 'refused',
      stringify: 'refused',
      map: 'refused',
      iterator: 'refused',
      promise: 'refused',
      console: 'refused',
      runtime: 'refused',
    })
    expect(await command('escape', 'still')).toEqual({ text: '2,4' })
    expect(reports).toEqual([])
    await host.stop()
  })

  test("its own objects still assign over what they inherit (SES's override mistake)", async () => {
    const { command, host } = await hostWithVms(
      {
        own: `
          class Failure extends Error {}
          export function register(on) {
            on('command.run', { command: 'assign' }, async () => {
              const error = new Failure('boom')
              error.name = 'Failure'
              const value = {}
              value.toString = () => 'mine'
              value.constructor = 'kept'
              const list = [1, 2]
              list.push = (x) => 'pushed ' + x
              return { text: [error.name, String(value), value.constructor, list.push(3), String(error)].join('|') }
            })
          }
        `,
      },
      { vms },
    )
    expect(await command('own', 'assign')).toEqual({
      text: 'Failure|mine|kept|pushed 3|Failure: boom',
    })
    await host.stop()
  })

  test("console prints text and never runs a value's own inspect; web APIs work after the lockdown", async () => {
    const { command, host, printed, reports } = await hostWithVms(
      {
        web: `
          export function register(on) {
            on('command.run', { command: 'web' }, async () => {
              console.log({ [Symbol.for('nodejs.util.inspect.custom')]: () => 'inspected', a: 1 })
              console.error(new Error('printed'), new Map([[1, 2]]), 10n, Symbol('s'))
              const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('abc'))
              const controller = new AbortController()
              let heard = 'no'
              controller.signal.addEventListener('abort', () => (heard = 'yes'))
              controller.abort()
              const url = new URL('https://x.test/a?b=c')
              return {
                text: [
                  new TextDecoder().decode(new TextEncoder().encode('abc')),
                  digest.byteLength,
                  structuredClone({ at: [7] }).at[0],
                  url.searchParams.get('b'),
                  heard + ' ' + controller.signal.reason.name,
                  btoa('hi'),
                ].join('|'),
              }
            })
          }
        `,
      },
      { vms },
    )
    expect(await command('web', 'web')).toEqual({ text: 'abc|32|7|c|yes AbortError|aGk=' })
    expect(printed).toEqual(['log {"a":1}', 'error Error: printed {} 10n Symbol(s)'])
    expect(reports).toEqual([])
    await host.stop()
  })
})
