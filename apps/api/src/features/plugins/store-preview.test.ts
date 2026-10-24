import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'

import { previewMarketplace } from './store-preview'

const dir = tempDirPerTest('plugin-store-preview-')

describe('a marketplace read before it is added', () => {
  test('says what it would add and keeps nothing', async () => {
    const market = join(dir(), 'acme-market')
    writeTree(market, {
      '.claude-plugin/marketplace.json': JSON.stringify({
        name: 'acme',
        owner: { name: 'Acme' },
        plugins: [
          { name: 'lint', source: './lint', author: { name: 'Ada' } },
          { name: 'fmt', source: './fmt', author: 'Grace' },
          { name: 'more', source: './more' },
        ],
      }),
    })
    const root = join(dir(), 'marketplaces')
    const preview = await previewMarketplace(market, {
      root,
      cloneRepo: async () => {
        throw new Error('no network')
      },
    })
    expect(preview).toEqual({
      kind: 'plugin',
      id: 'acme',
      label: 'acme',
      publishers: ['Ada', 'Grace', 'Acme'],
      count: 3,
      icons: [],
      verified: false,
      added: false,
    })
    expect(existsSync(root) ? readdirSync(root) : []).toEqual([])
  })

  test('an address that is no marketplace is refused, saying why', async () => {
    await expect(
      previewMarketplace('not a source at all', {
        root: join(dir(), 'm'),
        cloneRepo: async () => {},
      }),
    ).rejects.toMatchObject({ status: 400 })
  })
})
