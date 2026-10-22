import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createScriptVms } from '@localixai/engine-scripts'
import { hostWithVms, manualClock } from './testing-mods'

/**
 * The host's rules for a mod's instance, whatever runs it: what a load may register, how long it
 * may take, and how often an instance may die before its mod stays stopped.
 */

const vms = createScriptVms()

describe('loading a mod', () => {
  test('nothing is written to disk: the VM gets the module as text', async () => {
    const { command, dir, host } = await hostWithVms(
      {
        plain: `export function register(on) {
          on('command.run', { command: 'hi' }, async () => ({ text: 'hi' }))
        }`,
      },
      { vms },
    )
    expect(await command('plain', 'hi')).toEqual({ text: 'hi' })
    const modDir = join(dir, 'data', 'plain', 'mod')
    expect(existsSync(modDir) ? readdirSync(modDir) : []).toEqual([])
    await host.stop()
  })

  test('an event name that is no string refuses the load; a RegExp matcher is matched by the mod', async () => {
    const { command, host } = await hostWithVms(
      {
        numbered: `export function register(on) { on(123, async () => ({ text: 'never' })) }`,
        pattern: `export function register(on) {
          on('command.run', { command: /^re-/ }, async (_$, e) => ({ text: 'matched ' + e.command }))
        }`,
      },
      { vms },
    )
    expect(host.failures().get('numbered')).toContain('takes an event name')
    expect(await command('pattern', 're-x')).toEqual({ text: 'matched re-x' })
    expect(await command('pattern', 'other')).toEqual({})
    await host.stop()
  })

  test('a module that reaches for import.meta.require does not load; one that calls import() loads, and it rejects', async () => {
    const { command, host } = await hostWithVms(
      {
        meta: `export function register(on) { on('command.run', async () => ({ text: import.meta.require('fs') })) }`,
        dynamic: `export function register(on) {
          on('command.run', { command: 'import' }, async () => ({
            text: await import(['node', 'fs'].join(':')).then(() => 'loaded', (error) => 'refused: ' + error.message),
          }))
        }`,
      },
      { vms },
    )
    expect(host.failures().get('meta')).toContain('import.meta')
    expect(await command('dynamic', 'import')).toEqual({
      text: "refused: could not load module 'node:fs'",
    })
    await host.stop()
  })

  test('a register that never settles fails at the hook budget, and the reconcile goes on', async () => {
    const clock = manualClock()
    const { host, reports } = await hostWithVms(
      {
        stuck: `export async function register() { await new Promise(() => {}) }`,
        fine: `export function register(on) { on('command.run', { command: 'x' }, async () => ({})) }`,
      },
      { vms, clock, hangMs: 2_000 },
      async () => {
        await clock.armed(2_000)
        clock.advance(2_000)
      },
    )
    expect(host.failures().get('stuck')).toContain('did not finish loading within 2000 ms')
    expect(host.loaded()).toEqual(['fine'])
    expect(reports).toEqual([
      'stuck: the hooks module did not load: the hooks module did not finish loading within 2000 ms',
    ])
    await host.stop()
  })
})

describe('a mod that keeps dying', () => {
  test('starts again at once, then after a wait, and on the third death stays stopped', async () => {
    const clock = manualClock()
    const { command, host, reported, reports } = await hostWithVms(
      {
        fragile: `
          export function register(on) {
            on('command.run', { command: 'count' }, async () => ({ text: 'alive' }))
            on('command.run', { command: 'crash' }, async () => {
              queueMicrotask(() => {
                throw new Error('boom')
              })
              return { text: 'crashing' }
            })
          }
        `,
      },
      { vms, clock },
    )
    const crash = async () => {
      const crashed = reported('crashed')
      await command('fragile', 'crash')
      return crashed
    }
    expect(await crash()).toContain('it starts again on its next event')
    expect(await command('fragile', 'count')).toEqual({ text: 'alive' })
    expect(await crash()).toContain('it starts again on its next event after 1 s')
    // Backing off: the mod sits this event out.
    expect(await command('fragile', 'count')).toEqual({})
    clock.advance(1_000)
    expect(await command('fragile', 'count')).toEqual({ text: 'alive' })
    expect(await crash()).toContain('stays stopped until the plugin changes')
    expect(await command('fragile', 'count')).toEqual({})
    expect(host.failures().get('fragile')).toContain('stopped 3 times')
    expect(reports.filter((line) => line.includes('the hooks module crashed: boom;'))).toHaveLength(
      3,
    )
    await host.stop()
  })
})
