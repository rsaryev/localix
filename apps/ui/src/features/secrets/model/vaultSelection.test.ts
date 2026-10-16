import { describe, expect, it } from 'bun:test'

import { selectionAfterVaultRefresh, toggleVaultSelection } from './vaultSelection'

const items = [{ key: 'API_KEY' }, { key: 'DATABASE_URL' }]

describe('Vault item selection', () => {
  it('keeps details closed after the initial refresh', () => {
    expect(selectionAfterVaultRefresh(items, null)).toBeNull()
  })

  it('preserves explicit and deep-linked selections', () => {
    expect(selectionAfterVaultRefresh(items, 'DATABASE_URL')).toBe('DATABASE_URL')
    expect(selectionAfterVaultRefresh(items, null, 'API_KEY')).toBe('API_KEY')
  })

  it('closes details when the selected item is clicked again', () => {
    expect(toggleVaultSelection(null, 'API_KEY')).toBe('API_KEY')
    expect(toggleVaultSelection('API_KEY', 'API_KEY')).toBeNull()
  })
})
