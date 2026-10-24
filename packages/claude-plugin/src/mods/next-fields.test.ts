import { expect, test } from 'bun:test'
import { createModsEngine } from './engine'

/** What `next` carries beside the call: the event's name, `is`, and the trace of what ran. */

test('a glob hook reads next.event and next.is; next.trace lists the links beneath, the engine last', async () => {
  const engine = createModsEngine()
  const seen: unknown[] = []
  await engine.load(
    'watcher',
    (on) =>
      void on('tool.*', async (_$, e, next) => {
        const answer = await next(e)
        seen.push({
          event: next.event,
          isCall: next.is('tool.call', e),
          notDescribe: next.is('!tool.describe', e),
          trace: next.trace.map(({ plugin, tier, outcome, returned }) => ({
            plugin,
            tier,
            outcome,
            returned,
          })),
        })
        return answer
      }),
    {},
    {},
  )
  await engine.load('guard', (on) => void on('tool.call', () => ({ deny: 'no' })), {}, {})
  await engine.dispatch('tool.call', { tool: 'Bash' }, () => ({ result: 'ran' }))
  await engine.dispatch('tool.describe', { tool: 'Bash' }, () => ({ description: 'd' }))
  expect(seen).toEqual([
    {
      event: 'tool.call',
      isCall: true,
      notDescribe: true,
      trace: [{ plugin: 'guard', tier: 'user', outcome: 'returned', returned: { deny: 'no' } }],
    },
    {
      event: 'tool.describe',
      isCall: false,
      notDescribe: false,
      trace: [
        { plugin: 'engine', tier: 'core', outcome: 'returned', returned: { description: 'd' } },
      ],
    },
  ])
})

test('a negation selects every event but the one it names', async () => {
  const engine = createModsEngine()
  const heard: string[] = []
  await engine.load(
    'm',
    (on) => void on('!tool.describe', (_$, e, next) => (heard.push(next.event), next(e))),
    {},
    {},
  )
  await engine.dispatch('tool.describe', {}, () => ({}))
  await engine.dispatch('tool.call', {}, () => ({}))
  expect(heard.filter((name) => name.startsWith('tool.'))).toEqual(['tool.call'])
})

test('an abandoned event goes no further: core never runs beneath a hook it cut short', async () => {
  const engine = createModsEngine()
  await engine.load(
    'holder',
    (on) =>
      void on('tool.call', (_$, _e, next) =>
        next.signal.aborted
          ? undefined
          : new Promise((resolve) => next.signal.addEventListener('abort', resolve)),
      ),
    {},
    {},
  )
  let ran = 0
  const stop = new AbortController()
  const dispatched = engine
    .dispatch('tool.call', { tool: 'Bash' }, () => (ran++, { result: 'ran' }), {
      signal: stop.signal,
    })
    .then(
      () => 'answered',
      () => 'abandoned',
    )
  stop.abort()
  expect(await dispatched).toBe('abandoned')
  expect(ran).toBe(0)
})

test('the chain follows the mods’ order, not the order their instances happened to start in', async () => {
  const order = ['first', 'second']
  const engine = createModsEngine({ rankOf: (mod) => order.indexOf(mod.split('~')[0]!) })
  const heard: string[] = []
  const hook = (name: string) => (on: Parameters<Parameters<typeof engine.load>[1]>[0]) =>
    void on('turn.start', (_$, e, next) => (heard.push(name), next(e)))
  // The second plugin's instance in this project started before the first's.
  await engine.load('second~p', hook('second'), {}, {})
  await engine.load('first~p', hook('first'), {}, {})
  await engine.dispatch('turn.start', {}, () => ({}))
  expect(heard).toEqual(['first', 'second'])
})
