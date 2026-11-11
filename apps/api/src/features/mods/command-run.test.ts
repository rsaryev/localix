import { expect, test } from 'bun:test'
import { hostWithMods } from './testing/testing-host'

test('a command typed in a conversation runs in its host, among the mods its turn loaded', async () => {
  const ended: string[] = []
  const { host, scene } = await hostWithMods({
    counter: (on) => {
      let count = 0
      on('session.start', async ($: { command: { register(def: object): unknown } }) => {
        await $.command.register({ name: 'count' })
      })
      on('command.run', { command: 'count' }, async () => ({ text: String(++count) }))
    },
    watcher: (on) => {
      on('session.end', async () => void ended.push('watcher'))
    },
  })
  // The conversation's turn loaded both mods; the command names only its own.
  const before = await host.hostFor(scene, new Set(['counter', 'watcher']))
  expect(await host.runCommand({ command: 'count' }, scene, new Set(['counter']))).toEqual({
    text: '1',
  })
  expect(await host.runCommand({ command: 'count' }, scene, new Set(['counter']))).toEqual({
    text: '2',
  })
  expect(ended).toEqual([])
  expect(await host.hostFor(scene, new Set(['counter', 'watcher']))).toBe(before)
})

test('a command in a conversation with no host yet loads one with its mod', async () => {
  const { host } = await hostWithMods({
    counter: (on) => {
      on('session.start', async ($: { command: { register(def: object): unknown } }) => {
        await $.command.register({ name: 'count' })
      })
      on('command.run', { command: 'count' }, async () => ({ text: 'counted' }))
    },
  })
  const fresh = { userId: 'u', sessionId: 's-new', cwd: '/w' }
  expect(await host.runCommand({ command: 'count' }, fresh, new Set(['counter']))).toEqual({
    text: 'counted',
  })
})
