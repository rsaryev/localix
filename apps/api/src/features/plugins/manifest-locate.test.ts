import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  locateManifest,
  MARKETPLACE_MANIFEST_CANDIDATES,
  PLUGIN_MANIFEST_CANDIDATES,
} from './manifest-locate'
import { CLAUDE_CODE_MARKETPLACE, CLAUDE_CODE_PLUGIN_MANIFEST } from './import-claude-code'

/**
 * Shared manifest-locating core: first existing candidate wins, candidate order is the
 * precedence order, and each caller reads exactly one branded location.
 */

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'manifest-locate-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

async function touch(rel: string): Promise<void> {
  const abs = join(dir, rel)
  await fs.mkdir(join(abs, '..'), { recursive: true })
  await fs.writeFile(abs, '{}')
}

describe('locateManifest', () => {
  it('returns null when no candidate exists', async () => {
    expect(await locateManifest(dir, PLUGIN_MANIFEST_CANDIDATES)).toBeNull()
    expect(await locateManifest(dir, MARKETPLACE_MANIFEST_CANDIDATES)).toBeNull()
  })

  it('candidate order is the precedence order (first existing wins)', async () => {
    await touch('a.json')
    await touch('b.json')
    expect(await locateManifest(dir, ['b.json', 'a.json'])).toBe(join(dir, 'b.json'))
    expect(await locateManifest(dir, ['a.json', 'b.json'])).toBe(join(dir, 'a.json'))
    expect(await locateManifest(dir, ['missing.json', 'b.json'])).toBe(join(dir, 'b.json'))
  })

  it('plugin candidates: only the root plugin.json, never a foreign layout', async () => {
    await touch(CLAUDE_CODE_PLUGIN_MANIFEST)
    expect(await locateManifest(dir, PLUGIN_MANIFEST_CANDIDATES)).toBeNull()
    await touch('plugin.json')
    expect(await locateManifest(dir, PLUGIN_MANIFEST_CANDIDATES)).toBe(join(dir, 'plugin.json'))
  })

  it('marketplace candidates: only .localix-plugin/marketplace.json', async () => {
    await touch('marketplace.json')
    await touch(CLAUDE_CODE_MARKETPLACE)
    expect(await locateManifest(dir, MARKETPLACE_MANIFEST_CANDIDATES)).toBeNull()
    await touch('.localix-plugin/marketplace.json')
    expect(await locateManifest(dir, MARKETPLACE_MANIFEST_CANDIDATES)).toBe(
      join(dir, '.localix-plugin', 'marketplace.json'),
    )
  })
})
