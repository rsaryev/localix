import { expect, test } from 'bun:test'
import { hostWithMod, hostWithMods, type TestHook } from './testing/testing-host'

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

test('$.command.list gives Localix’s own commands first, each with its source, then the mods’', async () => {
  let listed: unknown
  const { scope } = await hostWithMod(
    (on) => {
      on('session.start', async ($: { command: { register(def: object): unknown } }) => {
        await $.command.register({ name: 'count', description: 'Counts' })
      })
      on('turn.start', async ($: { command: { list(): Promise<unknown> } }, e, next) => {
        listed = await $.command.list()
        return next(e)
      })
    },
    {
      listCommands: async () => [
        { name: 'compact', description: 'Compact', source: 'builtin' },
        { name: 'kit:lint', description: 'Lints', source: 'plugin', plugin: 'kit' },
      ],
    },
  )
  await scope.turnStart('hi', 't1')
  expect(listed).toMatchObject([
    { name: 'compact', source: 'builtin' },
    { name: 'kit:lint', source: 'plugin', plugin: 'kit' },
    { name: 'count', description: 'Counts', source: 'plugin', plugin: 'm' },
  ])
})

// `$.command.run` fires `command.run` once, through every mod's hooks (api.md, "Add a command"):
// when none answers, the call's own end is the command's body, not a second `command.run` through
// the same hooks, which a pass-through hook would count twice.
test('$.command.run fires command.run once, even when no mod answers it', async () => {
  const seen: string[] = []
  let answer: unknown
  const { host, scene } = await hostWithMods({
    caller: (on) => {
      on('session.start', async ($: { command: { register(def: object): unknown } }) => {
        await $.command.register({ name: 'go' })
      })
      on('command.run', { command: 'go' }, async ($: { command: { run(c: object): unknown } }) => {
        answer = await Promise.resolve($.command.run({ command: 'nobody', args: '' })).catch(
          (error: Error) => error.message,
        )
        return { text: 'went' }
      })
    },
    watcher: (on) => {
      on('command.run', async (_$: unknown, e: { command: string }, next: TestHook) => {
        seen.push(e.command)
        return next(e)
      })
    },
  })
  expect(await host.runCommand({ command: 'go' }, scene)).toEqual({ text: 'went' })
  expect(seen.filter((command) => command === 'nobody')).toEqual(['nobody'])
  expect(answer).toContain('not /nobody')
})
