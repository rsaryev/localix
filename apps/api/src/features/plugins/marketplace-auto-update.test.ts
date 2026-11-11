import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import {
  autoUpdatePassAllowed,
  isOfficialMarketplace,
  marketplaceAutoUpdate,
  OFFICIAL_MARKETPLACE,
  setMarketplaceAutoUpdate,
} from './marketplace-auto-update'
import { readKnownMarketplaces, writeKnownMarketplaces } from './kit'

const dir = tempDirPerTest('auto-update-')
const CATALOG = '.claude-plugin/marketplace.json'
/** No update variables and no managed settings: the toggle is the person's. */
const quiet = () => ({ env: {}, managedSettingsDir: join(dir(), 'none') })
const AT = '2026-01-01T00:00:00.000Z'
const official = {
  source: OFFICIAL_MARKETPLACE.source,
  installLocation: '/m/localix',
  lastUpdated: AT,
}
const thirdParty = {
  source: { kind: 'github' as const, repo: 'acme/tools', path: CATALOG },
  installLocation: '/m/acme',
  lastUpdated: AT,
}

describe('which marketplaces auto-update', () => {
  test('the official Localix marketplace is on by default, every other one off', () => {
    expect(isOfficialMarketplace('localix', official)).toBe(true)
    expect(marketplaceAutoUpdate('localix', official)).toBe(true)
    expect(marketplaceAutoUpdate('acme', thirdParty)).toBe(false)
  })

  test('a marketplace named localix from another source is not the official one', () => {
    expect(isOfficialMarketplace('localix', thirdParty)).toBe(false)
    // The app's own repository is not the marketplace: Localix's plugins and mini apps live in a
    // repository of their own, and the core knows them only by that address.
    const appRepository = {
      ...thirdParty,
      source: { kind: 'github' as const, repo: 'rsaryev/localix', path: CATALOG },
    }
    expect(isOfficialMarketplace('localix', appRepository)).toBe(false)
    expect(
      isOfficialMarketplace('localix', {
        source: {
          kind: 'git',
          url: 'https://github.com/rsaryev/localix-marketplace.git',
          path: CATALOG,
        },
      }),
    ).toBe(true)
    expect(marketplaceAutoUpdate('localix', thirdParty)).toBe(false)
  })

  test('Claude Code’s official marketplaces keep the default the kit gives them', () => {
    const anthropic = {
      ...thirdParty,
      source: {
        kind: 'github' as const,
        repo: 'anthropics/claude-plugins-official',
        path: CATALOG,
      },
    }
    expect(marketplaceAutoUpdate('claude-plugins-official', anthropic)).toBe(true)
    expect(marketplaceAutoUpdate('knowledge-work-plugins', anthropic)).toBe(false)
  })

  test('the person’s choice on the record wins over the default', () => {
    expect(marketplaceAutoUpdate('localix', { ...official, autoUpdate: false })).toBe(false)
    expect(marketplaceAutoUpdate('acme', { ...thirdParty, autoUpdate: true })).toBe(true)
  })

  test('the toggle is written to the record and kept when the marketplace is re-registered', async () => {
    const root = join(dir(), 'marketplaces')
    await writeKnownMarketplaces(root, { acme: thirdParty })
    await setMarketplaceAutoUpdate(root, 'acme', true, quiet())
    expect((await readKnownMarketplaces(root)).acme?.autoUpdate).toBe(true)
    await expect(setMarketplaceAutoUpdate(root, 'nope', true, quiet())).rejects.toMatchObject({
      code: 'marketplace_not_found',
    })
  })
})

describe('the Marketplaces toggle, as the kit decides it', () => {
  test('a managed entry that sets autoUpdate refuses the toggle and leaves the record alone', async () => {
    const root = join(dir(), 'marketplaces')
    const managedSettingsDir = join(dir(), 'managed')
    await writeTree(managedSettingsDir, {
      'managed-settings.json': JSON.stringify({
        extraKnownMarketplaces: {
          acme: { source: { source: 'github', repo: 'acme/tools' }, autoUpdate: false },
        },
      }),
    })
    await writeKnownMarketplaces(root, { acme: thirdParty })
    await expect(
      setMarketplaceAutoUpdate(root, 'acme', true, { env: {}, managedSettingsDir }),
    ).rejects.toMatchObject({
      code: 'marketplace_auto_update_managed',
      message:
        "Auto-update for 'acme' is set by your organization's managed settings and cannot be changed here",
    })
    expect((await readKnownMarketplaces(root)).acme?.autoUpdate).toBeUndefined()
  })

  test('while the whole pass is off the toggle is refused', async () => {
    const root = join(dir(), 'marketplaces')
    await writeKnownMarketplaces(root, { acme: thirdParty })
    await expect(
      setMarketplaceAutoUpdate(root, 'acme', true, {
        env: { DISABLE_UPDATES: '1' },
        managedSettingsDir: join(dir(), 'none'),
      }),
    ).rejects.toMatchObject({ code: 'marketplace_auto_update_paused' })
    expect((await readKnownMarketplaces(root)).acme?.autoUpdate).toBeUndefined()
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
    await Promise.all(
      names.map((name, i) => setMarketplaceAutoUpdate(root, name, i % 2 === 0, quiet())),
    )
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

  test('any value of CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC turns it off; 0 of the others does not', () => {
    expect(autoUpdatePassAllowed({ CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 'yes please' })).toBe(
      false,
    )
    expect(autoUpdatePassAllowed({ DISABLE_UPDATES: '0' })).toBe(true)
  })

  test('FORCE_AUTOUPDATE_PLUGINS=1 keeps the pass on anyway', () => {
    expect(autoUpdatePassAllowed({ DISABLE_AUTOUPDATER: '1', FORCE_AUTOUPDATE_PLUGINS: '1' })).toBe(
      true,
    )
  })
})
