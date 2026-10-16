import { describe, expect, test } from 'bun:test'

import { VAULT_ITEM_TYPES } from '@localixai/api/client'
import { VAULT_TYPE_PRESENTATION, vaultTypeIcon } from './vaultTypePresentation'

describe('Vault item type icon vocabulary', () => {
  test('covers every canonical type with a distinct local monochrome icon', () => {
    const icons = VAULT_ITEM_TYPES.map((type) => VAULT_TYPE_PRESENTATION[type].Icon)

    expect(Object.keys(VAULT_TYPE_PRESENTATION).sort()).toEqual([...VAULT_ITEM_TYPES].sort())
    expect(icons.every((Icon) => typeof Icon === 'object' || typeof Icon === 'function')).toBe(true)
    expect(new Set(icons).size).toBe(VAULT_ITEM_TYPES.length)
  })

  test('resolves the crypto wallet presentation through the shared registry', () => {
    expect(vaultTypeIcon('crypto_wallet')).toBe(VAULT_TYPE_PRESENTATION.crypto_wallet.Icon)
    expect(VAULT_TYPE_PRESENTATION.crypto_wallet.tone).toBe('warning')
  })
})
