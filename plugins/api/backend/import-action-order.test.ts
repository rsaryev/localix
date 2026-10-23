import { expect, test } from 'bun:test'
import { runImportAction } from './import-action'
import { createMemoryCollection } from './collection/testing/memory'

test('vaults the whole batch before saving requests, then saves environments', async () => {
  const store = createMemoryCollection()
  const events: string[] = []
  const sources = [
    'curl -H "Authorization: Bearer first-token" https://api.test/first',
    'curl -H "Authorization: Bearer second-token" https://api.test/second',
    JSON.stringify({
      _postman_variable_scope: 'environment',
      name: 'Staging',
      values: [{ key: 'base_url', value: 'https://api.test' }],
    }),
  ]
  const out = await runImportAction(
    {
      userId: 'u',
      store: {
        ...store,
        list: async () => {
          events.push('list')
          return store.list()
        },
        save: async (name, spec) => {
          events.push('request')
          expect(spec.auth.type).toBe('bearer')
          if (spec.auth.type === 'bearer') expect(spec.auth.token).toStartWith('${secret:')
          if (name.endsWith('second')) return { ok: false, problem: 'refused for test' }
          return store.save(name, spec)
        },
      },
      storeSecret: async () => {
        events.push('vault')
        return true
      },
      environments: {
        save: async () => {
          events.push('environment')
          throw new Error('environment refused')
        },
      },
    },
    sources,
    true,
  )
  expect(events).toEqual(['list', 'vault', 'vault', 'request', 'request', 'environment'])
  expect(store.records.size).toBe(1)
  expect(out.ok).toBe(true)
  if (!out.ok) throw new Error(out.problem)
  expect(out.content).toContain('https://api.test/first')
  expect(out.content).not.toContain('https://api.test/second')
  expect(out.content).toContain('refused for test')
  expect(out.content).toContain('environment refused')
  expect(out.content).not.toContain('first-token')
  expect(out.content).not.toContain('second-token')
})
