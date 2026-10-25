import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest } from '@localixai/testing'

import {
  autoUpdatePassAllowed,
  isOfficialMarketplace,
  marketplaceAutoUpdate,
  OFFICIAL_MARKETPLACE,
  setMarketplaceAutoUpdate,
} from './marketplace-auto-update'
import { readKnownMarketplaces, writeKnownMarketplaces } from './marketplace-catalog'

const dir = tempDirPerTest('auto-update-')
const official = { source: OFFICIAL_MARKETPLACE.source, installLocation: '/m/localix' }
const thirdParty = {
  source: { source: 'github' as const, repo: 'acme/tools' },
  installLocation: '/m/acme',
}

describe('which marketplaces auto-update', () => {
  test('the official Localix marketplace is on by default, every other one off', () => {
    expect(isOfficialMarketplace('localix', official)).toBe(true)
    expect(marketplaceAutoUpdate('localix', official)).toBe(true)
    expect(marketplaceAutoUpdate('acme', thirdParty)).toBe(false)
  })

  test('a marketplace named localix from another source is not the official one', () => {
    expect(isOfficialMarketplace('localix', thirdParty)).toBe(false)
    expect(marketplaceAutoUpdate('localix', thirdParty)).toBe(false)
  })

  test('the person’s choice on the record wins over the default', () => {
    expect(marketplaceAutoUpdate('localix', { ...official, autoUpdate: false })).toBe(false)
    expect(marketplaceAutoUpdate('acme', { ...thirdParty, autoUpdate: true })).toBe(true)
  })

  test('the toggle is written to the record and kept when the marketplace is re-registered', async () => {
    const root = join(dir(), 'marketplaces')
    await writeKnownMarketplaces(root, { acme: thirdParty })
    await setMarketplaceAutoUpdate(root, 'acme', true)
    expect((await readKnownMarketplaces(root)).acme?.autoUpdate).toBe(true)
    await expect(setMarketplaceAutoUpdate(root, 'nope', true)).rejects.toMatchObject({
      code: 'marketplace_not_found',
    })
  })
})

describe('writing the registry from several places at once', () => {
  test('switches made together are all kept, and a reader never sees a half-written file', async () => {
    const root = join(dir(), 'marketplaces')
    const names = Array.from({ length: 12 }, (_, i) => `m${i}`)
    await writeKnownMarketplaces(
      root,
      Object.fromEntries(
        names.map((name) => [name, { ...thirdParty, installLocation: `/m/${name}` }]),
      ),
    )
    let sawGap = false
    const watching = (async () => {
      for (let i = 0; i < 60; i++) {
        if (Object.keys(await readKnownMarketplaces(root)).length !== names.length) sawGap = true
      }
    })()
    await Promise.all(names.map((name, i) => setMarketplaceAutoUpdate(root, name, i % 2 === 0)))
    await watching
    const known = await readKnownMarketplaces(root)
    expect(names.map((name) => known[name]?.autoUpdate)).toEqual(names.map((_, i) => i % 2 === 0))
    expect(sawGap).toBe(false)
  })
})

describe('the environment variables that turn the whole pass off', () => {
  test('DISABLE_UPDATES, DISABLE_AUTOUPDATER and CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', () => {
    expect(autoUpdatePassAllowed({})).toBe(true)
    for (const name of [
      'DISABLE_UPDATES',
      'DISABLE_AUTOUPDATER',
      'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    ])
      expect(autoUpdatePassAllowed({ [name]: '1' })).toBe(false)
  })

  test('FORCE_AUTOUPDATE_PLUGINS=1 keeps the pass on anyway', () => {
    expect(autoUpdatePassAllowed({ DISABLE_AUTOUPDATER: '1', FORCE_AUTOUPDATE_PLUGINS: '1' })).toBe(
      true,
    )
  })
})
