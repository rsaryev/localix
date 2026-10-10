import { expect, test } from 'bun:test'

import { createUiLocationRegistry } from './uiLocations'

test('changing a catalog descriptor cannot alter registered metadata or accepted URI arguments', () => {
  const registry = createUiLocationRegistry()
  const uri = 'localix://ui/work-item/record/open'
  expect(
    registry.register({
      id: 'record',
      uri,
      title: 'Record',
      effect: 'read',
      surface: 'work-item',
      keywords: ['original'],
      exposure: { search: true },
      agent: { description: 'Original description' },
      params: { query: { type: 'string', values: ['one', 'two'], description: 'Query' } },
      resolve: () => ({ kind: 'work-item', workKind: 'record', id: 'record', title: 'Record' }),
    }),
  ).toBe(true)
  const revision = registry.revision()
  const emitted = registry.list()[0]!
  Reflect.set(emitted.keywords, 0, 'changed')
  Reflect.set(emitted.exposure, 'search', false)
  Reflect.set(emitted.agent!, 'description', 'Changed description')
  const parameter = emitted.params.query!
  expect(parameter.type).toBe('string')
  if (parameter.type !== 'string' || !parameter.values) throw new Error('Missing query choices')
  Reflect.set(parameter.values, 0, 'changed')
  Reflect.set(parameter, 'description', 'Changed query')

  expect(registry.list({ exposure: 'search' })[0]).toMatchObject({
    keywords: ['original'],
    exposure: { search: true },
    agent: { description: 'Original description' },
    params: { query: { values: ['one', 'two'], description: 'Query' } },
  })
  expect(registry.resolve(`${uri}?query=one`)).not.toBeNull()
  expect(registry.resolve(`${uri}?query=changed`)).toBeNull()
  expect(registry.revision()).toBe(revision)
})
