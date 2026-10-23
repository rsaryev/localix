import { expect, test } from 'bun:test'
import { createScriptVms } from '@localixai/engine-scripts'
import { hostWithVms } from './testing/testing-mods'

/**
 * A mod gone wrong on the real VM: a hook that never yields the thread — a plain loop or a loop of
 * promise jobs — is interrupted at the turn limit while the host goes on answering, and the mod
 * starts again; memory past the VM's limit fails inside the VM, never the host; a rejection
 * nothing handled is reported without stopping the mod. The turn limit is the test's own (`hangMs`).
 */

const vms = createScriptVms()

const SPINNER = `
let starts = 0
export function register(on) {
  on('session.start', async ($, e, next) => {
    starts += 1
    return next(e)
  })
  on('command.run', { command: 'spin' }, async () => {
    for (;;) {}
  })
  on('command.run', { command: 'jobs' }, async () => {
    for (;;) await null
  })
  on('command.run', { command: 'starts' }, async () => ({ text: 'starts ' + starts }))
}
`

const OTHER = `
export function register(on) {
  on('command.run', { command: 'ping' }, async () => ({ text: 'pong' }))
}
`

for (const kind of ['spin', 'jobs'])
  test(`a hook that holds its thread (${kind}) is stopped, the host answers meanwhile, and the mod starts again`, async () => {
    const { command, host, reported, reports } = await hostWithVms(
      { spinner: SPINNER, other: OTHER },
      { vms, hangMs: 300, engine: { budgetMs: 150 } },
    )
    const stopped = reported('held its thread')
    const spinning = command('spinner', kind)
    expect(await command('other', 'ping')).toEqual({ text: 'pong' })
    // Out of time: the hook is skipped, and the command answers as with no mod.
    expect(await spinning).toEqual({})
    await stopped
    expect(await command('spinner', 'starts')).toEqual({ text: 'starts 1' })
    expect(reports).toEqual([
      'spinner: command.run: hook skipped: timeout ran out of time',
      'spinner: the hooks module held its thread for 300 ms; it starts again on its next event',
    ])
    await host.stop()
  }, 20_000)

test('memory past the limit fails the hook inside the VM; the mod and the host go on', async () => {
  const { command, host, reports } = await hostWithVms(
    {
      hungry: `
        export function register(on) {
          on('command.run', { command: 'eat' }, async () => {
            const meals = []
            for (;;) meals.push('x'.repeat(65536) + meals.length)
          })
          on('command.run', { command: 'careful' }, async () => {
            let meals = []
            try {
              for (;;) meals.push('x'.repeat(65536) + meals.length)
            } catch (error) {
              meals = null
              return { text: String(error) }
            }
          })
          on('command.run', { command: 'ping' }, async () => ({ text: 'pong' }))
        }
      `,
    },
    { vms, memoryLimitBytes: 16 * 1024 * 1024 },
  )
  expect(await command('hungry', 'eat')).toEqual({})
  expect(await command('hungry', 'careful')).toEqual({ text: 'InternalError: out of memory' })
  expect(await command('hungry', 'ping')).toEqual({ text: 'pong' })
  expect(reports).toEqual(['hungry: command.run: hook skipped: throw out of memory'])
  expect(host.instances().size).toBe(1)
  await host.stop()
})

test('a rejection nothing handled is reported, and the mod goes on', async () => {
  const { command, host, reported, reports } = await hostWithVms(
    {
      careless: `
        export function register(on) {
          on('command.run', { command: 'drop' }, async () => {
            Promise.reject(new Error('dropped'))
            return { text: 'ok' }
          })
        }
      `,
    },
    { vms },
  )
  const rejected = reported('unhandled rejection')
  expect(await command('careless', 'drop')).toEqual({ text: 'ok' })
  await rejected
  const again = reported('unhandled rejection')
  expect(await command('careless', 'drop')).toEqual({ text: 'ok' })
  await again
  expect(reports).toEqual([
    'careless: unhandled rejection: dropped',
    'careless: unhandled rejection: dropped',
  ])
  await host.stop()
})
