import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { readKnownMarketplaces } from './kit'
import type { ResolvedMarketplaceInstall } from './marketplace-registry'
import { candidateFor, type MarketplaceInstall } from './update-candidates'

/**
 * What an update would install, decided by the kit (plugins/loading.md, "Versions and updates"):
 * `precheckUpdate` before anything is fetched, then `checkForUpdate` on the fetched copy, which
 * makes a new copy only when the computed version differs from the recorded one. Localix fetches
 * as its install does, and compares no versions of its own.
 */
const dir = tempDirPerTest('update-candidates-')
const SHA_1 = '1111111111111111111111111111111111111111'
const SHA_2 = '2222222222222222222222222222222222222222'

type Fetched = Pick<ResolvedMarketplaceInstall, 'dir' | 'commitSha'>

/** A marketplace added from GitHub listing `plugins`, and its record as Localix keeps it. */
async function marketplace(
  plugins: unknown[],
  source: unknown = { source: 'github', repo: 'o/m' },
) {
  const root = join(dir(), 'marketplaces')
  const location = join(root, 'shop')
  writeTree(location, {
    '.claude-plugin/marketplace.json': JSON.stringify({
      name: 'shop',
      owner: { name: 'S' },
      plugins,
    }),
    'plugins/tool/.claude-plugin/plugin.json': JSON.stringify({ name: 'tool', version: '2.0.0' }),
  })
  writeTree(root, {
    'known_marketplaces.json': JSON.stringify({
      shop: { source, installLocation: location, lastUpdated: '2026-10-20T10:00:00.000Z' },
    }),
  })
  return readKnownMarketplaces(root)
}

const install = (version: string): MarketplaceInstall => ({
  id: 'tool@shop',
  name: 'tool',
  marketplace: 'shop',
  source: 'tool@shop',
  version,
})

/** A fetch of a git plugin whose manifest says `version`, at `commitSha`; records each call. */
function gitFetch(version: string | undefined, commitSha: string) {
  const calls: string[] = []
  const fetch = async (ref: { plugin: string; marketplace: string }): Promise<Fetched> => {
    calls.push(`${ref.plugin}@${ref.marketplace}`)
    const at = join(dir(), 'fetched', commitSha)
    writeTree(at, {
      '.claude-plugin/plugin.json': JSON.stringify({
        name: 'tool',
        ...(version ? { version } : {}),
      }),
    })
    return { dir: at, commitSha }
  }
  return { calls, fetch }
}

const noFetch = async (): Promise<Fetched> => {
  throw new Error('nothing is fetched')
}

describe('an update candidate', () => {
  test('a relative entry is read in the marketplace copy: a new manifest version is a candidate', async () => {
    const known = await marketplace([{ name: 'tool', source: './plugins/tool' }])
    const fetch = async (): Promise<Fetched> => ({
      dir: join(known.shop?.installLocation ?? '', 'plugins/tool'),
    })
    expect(await candidateFor(install('1.0.0'), known, fetch)).toEqual({ version: '2.0.0' })
    expect(await candidateFor(install('2.0.0'), known, fetch)).toBeNull()
  })

  test('a git plugin whose manifest pins its version has no update while its commits move', async () => {
    const known = await marketplace([
      { name: 'tool', source: { source: 'github', repo: 'o/tool' } },
    ])
    const git = gitFetch('1.0.0', SHA_2)
    expect(await candidateFor(install('1.0.0'), known, git.fetch)).toBeNull()
    expect(git.calls).toEqual(['tool@shop'])
  })

  test('a git plugin with no version tracks its commit', async () => {
    const known = await marketplace([
      { name: 'tool', source: { source: 'github', repo: 'o/tool' } },
    ])
    const git = gitFetch(undefined, SHA_2)
    expect(await candidateFor(install(SHA_1.slice(0, 12)), known, git.fetch)).toEqual({
      version: SHA_2.slice(0, 12),
    })
  })

  test('a relative entry of a marketplace read in place is never compared, nor fetched', async () => {
    const root = join(dir(), 'local')
    const known = await marketplace([{ name: 'tool', source: './plugins/tool' }], {
      source: 'directory',
      path: root,
    })
    expect(await candidateFor(install('1.0.0'), known, noFetch)).toBeNull()
  })

  test('a headersHelper or a command entry is left to the person, and nothing runs', async () => {
    const helper = await marketplace([
      { name: 'tool', source: './plugins/tool', headersHelper: 'echo {}' },
    ])
    expect(await candidateFor(install('1.0.0'), helper, noFetch)).toEqual({
      version: '1.0.0',
      manual: 'headers-helper',
    })
    const command = await marketplace([
      { name: 'tool', source: { source: 'command', command: 'echo /x' } },
    ])
    expect(await candidateFor(install('1.0.0'), command, noFetch)).toEqual({
      version: '1.0.0',
      manual: 'command-needs-acceptance',
    })
  })

  test('a plugin its marketplace no longer lists has no candidate', async () => {
    const known = await marketplace([{ name: 'other', source: './plugins/tool' }])
    expect(await candidateFor(install('1.0.0'), known, noFetch)).toBeNull()
  })

  // A check that could not run is not "no update": the caller reports it as unchecked.
  test('a listing that cannot be read or a fetch that fails rejects, rather than "no update"', async () => {
    const git = [{ name: 'tool', source: { source: 'github', repo: 'o/tool' } }]
    const known = await marketplace(git)
    await expect(candidateFor(install('1.0.0'), known, noFetch)).rejects.toThrow(
      'nothing is fetched',
    )
    writeTree(known.shop?.installLocation ?? '', { '.claude-plugin/marketplace.json': '{' })
    await expect(candidateFor(install('1.0.0'), known, noFetch)).rejects.toThrow()
  })
})
