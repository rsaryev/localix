/**
 * A marketplace entry's `headersHelper` (host-marketplace.md, "How users accept a headersHelper
 * command"; cli-reference.md, "--accept-command"): the command runs only when the person installs
 * or updates that one plugin and passes the sha256 they were shown, which counts "for exactly that
 * command, plugin, and marketplace catalog" (the kit's `decideAcceptance`); an install that has not
 * accepted it, or accepted another command or catalog, is refused and shows what would run.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'

import { stubFetch } from '../../testing/fetch-stub'
import { addMarketplace, resolveMarketplaceInstall } from './marketplace-registry'

const dir = tempDirPerTest('entry-headers-helper-')
const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const URL_ = 'https://registry.example.com/tool.zip'
const COMMAND = `printf '{"Authorization":"Bearer %s"}' "$CLAUDE_CODE_PLUGIN_NAME"`

/** The sha256 a refused install shows, to pass as `--accept-command`. */
async function shownDigest(deps: Parameters<typeof resolveMarketplaceInstall>[1]): Promise<string> {
  const error = await resolveMarketplaceInstall({ plugin: 'tool', marketplace: 'hosted' }, deps)
    .then(() => null)
    .catch((err: Error) => err)
  const sha = /--accept-command ([0-9a-f]{64})/.exec(error?.message ?? '')?.[1]
  if (!sha) throw new Error(`no digest shown: ${error?.message}`)
  return sha
}

async function market(managed: Record<string, unknown> = {}) {
  const root = join(dir(), 'marketplaces')
  const managedSettingsDir = join(dir(), 'managed')
  writeTree(managedSettingsDir, { 'managed-settings.json': JSON.stringify(managed) })
  const catalog = JSON.stringify({
    name: 'hosted',
    owner: { name: 'H' },
    plugins: [
      {
        name: 'tool',
        strict: false,
        source: { source: 'archive', url: URL_ },
        headersHelper: COMMAND,
      },
    ],
  })
  globalThis.fetch = stubFetch(async () => new Response(catalog))
  const seen: Array<Record<string, string> | undefined> = []
  const deps = {
    root,
    managedSettingsDir,
    cloneRepo: async () => {},
    fetchArchive: async (src: { headers?: Record<string, string> }) => {
      seen.push(src.headers)
    },
  }
  await addMarketplace({ kind: 'url', url: 'https://cat.example.com/m.json' }, deps)
  return { deps, seen }
}

describe("a marketplace entry's headersHelper", () => {
  it('is refused until accepted, showing the command, the archive URL and what to accept', async () => {
    const { deps, seen } = await market()
    const error = await resolveMarketplaceInstall({ plugin: 'tool', marketplace: 'hosted' }, deps)
      .then(() => null)
      .catch((err: Error & { code?: string }) => err)
    expect(error?.code).toBe('plugin_command_needs_acceptance')
    expect(error?.message).toContain(COMMAND)
    expect(error?.message).toContain(URL_)
    expect(error?.message).toMatch(/--accept-command [0-9a-f]{64}/)
    expect(seen).toEqual([])
  })

  it('runs once accepted, and its output becomes the download headers', async () => {
    const { deps, seen } = await market()
    const acceptCommand = await shownDigest(deps)
    await resolveMarketplaceInstall({ plugin: 'tool', marketplace: 'hosted' }, deps, {
      acceptCommand,
    })
    expect(seen).toEqual([{ authorization: 'Bearer tool' }])
  })

  it('refuses an acceptance given for another command, or in the old command-and-URL form', async () => {
    const { deps } = await market()
    const old = (command: string) =>
      createHash('sha256').update(`${command}\n${URL_}`).digest('hex')
    for (const acceptCommand of [old('echo {}'), old(COMMAND)])
      await expect(
        resolveMarketplaceInstall({ plugin: 'tool', marketplace: 'hosted' }, deps, {
          acceptCommand,
        }),
      ).rejects.toMatchObject({ code: 'plugin_command_needs_acceptance' })
  })

  it('accepted, still does not run while managed settings block commands; the download goes without it', async () => {
    const { deps, seen } = await market({ disableCommandPluginSources: true })
    const acceptCommand = await shownDigest(deps)
    await resolveMarketplaceInstall({ plugin: 'tool', marketplace: 'hosted' }, deps, {
      acceptCommand,
    })
    expect(seen).toEqual([{}])
  })

  it('asks again, refusing the old digest, once the catalog changed', async () => {
    const { deps } = await market()
    const before = await shownDigest(deps)
    const catalogFile = join(deps.root, 'hosted', '.claude-plugin', 'marketplace.json')
    const text = await fs.readFile(catalogFile, 'utf8')
    await fs.writeFile(catalogFile, text.replace('"H"', '"H2"'))
    const after = await shownDigest(deps)
    expect(after).not.toBe(before)
    await expect(
      resolveMarketplaceInstall({ plugin: 'tool', marketplace: 'hosted' }, deps, {
        acceptCommand: before,
      }),
    ).rejects.toMatchObject({ code: 'plugin_command_needs_acceptance' })
  })
})
