import { describe, expect, test } from 'bun:test'

import type { Scope } from './contract'
import {
  CONFIG_FIELD_TYPES,
  configFieldSchema,
  configValueSchema,
  listingConfigFromFields,
  scalarConfigValues,
  type DeclaredField,
} from './config'

const declared = (over: Partial<DeclaredField>): DeclaredField => ({
  key: 'API_URL',
  type: 'string',
  description: '',
  required: false,
  secret: false,
  value: null,
  isSet: false,
  ...over,
})

const user: { scope: Scope; scopes: Scope[] } = { scope: 'user', scopes: ['user'] }

describe('listingConfigFromFields', () => {
  test('a title is the label, the key the fallback, the description the help', () => {
    const { fields } = listingConfigFromFields(
      [declared({ key: 'A', title: 'Service URL', description: 'Where it lives' }), declared({})],
      user,
    )
    expect(fields[0]).toMatchObject({ key: 'A', label: 'Service URL', help: 'Where it lives' })
    expect(fields[1]).toMatchObject({ key: 'API_URL', label: 'API_URL' })
    expect(fields[1]?.help).toBeUndefined()
  })

  test('the declared type says which control it is', () => {
    const { fields } = listingConfigFromFields(
      [
        declared({ key: 'on', type: 'boolean' }),
        declared({ key: 'n', type: 'number', min: 1, max: 9 }),
        declared({ key: 'pick', enum: [{ value: 'a' }, { value: 'b' }] }),
        declared({ key: 'tags', multiple: true }),
        declared({ key: 'executor_model' }),
        declared({ key: 'dir', type: 'directory' }),
      ],
      user,
    )
    expect(fields.map((field) => field.type)).toEqual([
      'boolean',
      'number',
      'choice',
      'list',
      'model',
      'string',
    ])
    expect(fields[1]).toMatchObject({ min: 1, max: 9 })
    expect(fields[2]?.options).toEqual([{ value: 'a' }, { value: 'b' }])
  })

  test('values come typed, a list as items, and a secret is only said to be set', () => {
    const config = listingConfigFromFields(
      [
        declared({ key: 'n', type: 'number', value: 3 }),
        declared({ key: 'tags', multiple: true, value: '["a","b"]' }),
        declared({ key: 'unset' }),
        declared({ key: 'token', secret: true, isSet: true }),
        declared({ key: 'empty', secret: true }),
      ],
      user,
    )
    expect(config.values).toEqual({ n: 3, tags: ['a', 'b'], unset: null })
    expect(config.set).toEqual(['token'])
    expect(config.fields.find((field) => field.key === 'token')?.secret).toBe(true)
  })

  test('the scope it answers for and the scopes it has settings in travel with it', () => {
    const config = listingConfigFromFields([declared({})], {
      scope: 'project',
      scopes: ['user', 'project'],
    })
    expect(config).toMatchObject({ scope: 'project', scopes: ['user', 'project'] })
  })
})

describe('scalarConfigValues', () => {
  test('a map is stored as a JSON object, like a list as a JSON array', () => {
    expect(scalarConfigValues({ env: { A: '1' }, tags: ['x'] })).toEqual({
      env: '{"A":"1"}',
      tags: '["x"]',
    })
  })

  test('the field types a form can draw include a map and a multiple choice', () => {
    expect(
      configFieldSchema.parse({
        key: 'env',
        label: 'Env',
        type: 'map',
        required: false,
        secret: true,
      }).type,
    ).toBe('map')
    expect(configValueSchema.parse({ A: '1' })).toEqual({ A: '1' })
    expect(() => configValueSchema.parse({ A: 1 })).toThrow()
    expect(CONFIG_FIELD_TYPES).toContain('multichoice')
  })

  test('a list is stored the way providers keep it: a JSON array of strings', () => {
    expect(scalarConfigValues({ tags: ['a', 'b'], n: 2, on: false, s: 'x' })).toEqual({
      tags: '["a","b"]',
      n: 2,
      on: false,
      s: 'x',
    })
  })
})
