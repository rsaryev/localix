import { afterEach, describe, expect, it } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest } from '@localixai/testing'

import { stubFetch } from '../../testing/fetch-stub'
import { addMarketplace, resolveMarketplaceInstall } from './marketplace-registry'

/**
 * Headers on an archive download (host-marketplace.md, "Authenticate archive downloads"): the
 * marketplace's `url` source headers reach archives on the catalog's origin, an entry's own
 * `headers` win a name both set (an entry `headersHelper`: `entry-headers-helper.test.ts`).
 */

const dir = tempDirPerTest('mkt-archive-headers-')
const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

describe('archive download headers', () => {
  it("sends the marketplace url source's headers and the entry's own", async () => {
    const root = join(dir(), 'marketplaces')
    const catalog = JSON.stringify({
      name: 'hosted',
      owner: { name: 'H' },
      plugins: [
        {
          name: 'tool',
          source: { source: 'archive', url: 'https://cat.example.com/tool.zip' },
          headers: { 'X-Entry': 'e', Authorization: 'entry', Host: 'evil.example' },
        },
        { name: 'other', source: { source: 'archive', url: 'https://cdn.example.net/o.zip' } },
      ],
    })
    globalThis.fetch = stubFetch(async () => new Response(catalog))
    const deps = { root, cloneRepo: async () => {} }
    await addMarketplace(
      {
        source: 'url',
        url: 'https://cat.example.com/m.json',
        headers: { Authorization: 'mkt', 'X-Mkt': 'm' },
      },
      deps,
    )
    const seen: unknown[] = []
    const fetchArchive = async (src: { headers?: Record<string, string> }) => {
      seen.push(src.headers)
    }
    for (const plugin of ['tool', 'other'])
      await resolveMarketplaceInstall({ plugin, marketplace: 'hosted' }, { ...deps, fetchArchive })
    // Another origin gets no marketplace headers.
    expect(seen).toEqual([{ Authorization: 'entry', 'X-Mkt': 'm', 'X-Entry': 'e' }, undefined])
  })
})
