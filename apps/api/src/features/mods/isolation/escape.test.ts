import { describe, expect, test } from 'bun:test'
import { hostWithWorkers } from './testing-mods'

/**
 * What a hooks module can change in its worker: nothing its worker's own code relies on. A getter
 * redefined on `MessageEvent.prototype` ran in the worker's listener with the real global object
 * as `this.target`, and reached `Bun.spawnSync` and `Bun.env`; it is the escape these pin.
 */

const ESCAPE = `
let reached = 'nothing'
const attempt = (change) => {
  try {
    change()
    return 'changed'
  } catch {
    return 'refused'
  }
}
export function register(on) {
  on('command.run', { command: 'redefine' }, async () => {
    const data = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'data')
    return {
      text: JSON.stringify({
        data: attempt(() =>
          Object.defineProperty(MessageEvent.prototype, 'data', {
            configurable: true,
            get() {
              const real = this.target || this.currentTarget
              try {
                reached = typeof real.Bun.spawnSync + ' ' + Object.keys(real.Bun.env).length
              } catch (error) {
                reached = 'threw ' + error
              }
              return data.get.call(this)
            },
          }),
        ),
        target: attempt(() =>
          Object.defineProperty(Event.prototype, 'target', { get: () => 'mine' }),
        ),
        objectThen: attempt(() =>
          Object.defineProperty(Object.prototype, 'then', { get: () => (reached = 'then') }),
        ),
        map: attempt(() => {
          Array.prototype.map = () => []
        }),
        listener: attempt(() => {
          EventTarget.prototype.addEventListener = () => {}
        }),
        iterator: attempt(() => {
          Object.getPrototypeOf([][Symbol.iterator]()).next = () => ({ done: true })
        }),
        promise: attempt(() => {
          Promise.prototype.then = () => {}
        }),
      }),
    }
  })
  // The next message the worker hears runs its listener, which reads event.data.
  on('command.run', { command: 'reached' }, async () => ({ text: reached }))
}
`

describe('a mod changing what its worker relies on', () => {
  test('cannot redefine MessageEvent.prototype.data, Object.prototype or any intrinsic', async () => {
    const { command, host, reports } = await hostWithWorkers({ escape: ESCAPE })
    expect(JSON.parse((await command('escape', 'redefine')).text!)).toEqual({
      data: 'refused',
      target: 'refused',
      objectThen: 'refused',
      map: 'refused',
      listener: 'refused',
      iterator: 'refused',
      promise: 'refused',
    })
    expect(await command('escape', 'reached')).toEqual({ text: 'nothing' })
    expect(reports).toEqual([])
    await host.stop()
  })

  test("its own objects still assign over what they inherit (SES's override mistake)", async () => {
    const { command, host } = await hostWithWorkers({
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
            const bound = function () {}
            return { text: [error.name, String(value), value.constructor, list.push(3), String(error)].join('|') }
          })
        }
      `,
    })
    expect(await command('own', 'assign')).toEqual({
      text: 'Failure|mine|kept|pushed 3|Failure: boom',
    })
    await host.stop()
  })

  test("console prints text and never runs a value's own inspect; web APIs work after the lockdown", async () => {
    const { command, host, reports } = await hostWithWorkers({
      web: `
        export function register(on) {
          on('command.run', { command: 'web' }, async () => {
            let inspected = 'no'
            console.log({ [Symbol.for('nodejs.util.inspect.custom')]: () => (inspected = 'yes') })
            console.log(new Error('printed'), new Map([[1, 2]]), 10n, Symbol('s'))
            const zipped = new Response(
              new Blob(['abc']).stream().pipeThrough(new CompressionStream('gzip')),
            )
            const text = await new Response(
              (await zipped.blob()).stream().pipeThrough(new DecompressionStream('gzip')),
            ).text()
            const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
            const clone = structuredClone({ at: new Date(0) })
            return {
              text: [
                inspected,
                text,
                digest.byteLength,
                clone.at.getTime(),
                new URLPattern({ pathname: '/a/:b' }).exec('http://x/a/c').pathname.groups.b,
                new Intl.NumberFormat('en').format(1234),
              ].join('|'),
            }
          })
        }
      `,
    })
    expect(await command('web', 'web')).toEqual({ text: 'no|abc|32|0|c|1,234' })
    expect(reports).toEqual([])
    await host.stop()
  })
})
