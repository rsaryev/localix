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
