import { expect, test } from 'bun:test'

import { VAULT_ITEM_TYPES, VAULT_ITEM_TYPE_DEFINITIONS } from './vault-item-types'
import {
  VAULT_ITEM_TYPES as contractTypes,
  VAULT_ITEM_TYPE_DEFINITIONS as contractDefinitions,
  createSecretRequestSchema,
  vaultItemTypeSchema,
} from './contracts'

test('server schemas and browser vocabulary share one Vault category registry', () => {
  expect(contractTypes).toBe(VAULT_ITEM_TYPES)
  expect(contractDefinitions).toBe(VAULT_ITEM_TYPE_DEFINITIONS)
  expect(Object.keys(VAULT_ITEM_TYPE_DEFINITIONS)).toEqual([...VAULT_ITEM_TYPES])
  for (const type of VAULT_ITEM_TYPES) {
    expect(vaultItemTypeSchema.parse(type)).toBe(type)
    expect(
      createSecretRequestSchema.parse({ key: 'EXAMPLE_KEY', value: 'example', type }).type,
    ).toBe(type)
  }
  expect(vaultItemTypeSchema.safeParse('unknown-category').success).toBe(false)
  expect(createSecretRequestSchema.parse({ key: 'EXAMPLE_KEY', value: 'example' }).type).toBe(
    'secret',
  )
})
