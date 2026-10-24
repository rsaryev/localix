/**
 * A marketplace entry's `headersHelper` (host-marketplace.md, "How users accept a headersHelper
 * command"): the command runs only when the person installs or updates that one plugin and accepts
 * the command and archive URL they were shown; an install that has not accepted it, or accepted
 * another command, is refused and shows what would run.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { stubFetch } from '../../testing/fetch-stub'
import { addMarketplace, resolveMarketplaceInstall } from './marketplace-registry'
import { headersHelperAcceptance } from './entry-headers-helper'

const dir = tempDirPerTest('entry-headers-helper-')
const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const URL_ = 'https://registry.example.com/tool.zip'
const COMMAND = `printf '{"Authorization":"Bearer %s"}' "$CLAUDE_CODE_PLUGIN_NAME"`

async function market() {
  const root = join(dir(), 'marketplaces')
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
    cloneRepo: async () => {},
    fetchArchive: async (src: { headers?: Record<string, string> }) => {
      seen.push(src.headers)
    },
  }
  await addMarketplace({ source: 'url', url: 'https://cat.example.com/m.json' }, deps)
  return { deps, seen }
}

describe("a marketplace entry's headersHelper", () => {
  it('is refused until accepted, showing the command, the archive URL and what to accept', async () => {
    const { deps, seen } = await market()
    const error = await resolveMarketplaceInstall({ plugin: 'tool', marketplace: 'hosted' }, deps)
      .then(() => null)
      .catch((err: Error & { code?: string }) => err)
    const sha = headersHelperAcceptance(COMMAND, URL_)
    expect(error?.code).toBe('plugin_command_needs_acceptance')
    expect(error?.message).toContain(COMMAND)
    expect(error?.message).toContain(URL_)
    expect(error?.message).toContain(sha)
    expect(seen).toEqual([])
  })

  it('runs once accepted, and its output becomes the download headers', async () => {
    const { deps, seen } = await market()
    const acceptCommand = headersHelperAcceptance(COMMAND, URL_)
    await resolveMarketplaceInstall({ plugin: 'tool', marketplace: 'hosted' }, deps, {
      acceptCommand,
    })
    expect(seen).toEqual([{ Authorization: 'Bearer tool' }])
  })

  it('refuses an acceptance given for another command', async () => {
    const { deps } = await market()
    const acceptCommand = headersHelperAcceptance('echo {}', URL_)
    await expect(
      resolveMarketplaceInstall({ plugin: 'tool', marketplace: 'hosted' }, deps, { acceptCommand }),
    ).rejects.toMatchObject({ code: 'plugin_command_needs_acceptance' })
  })
})
