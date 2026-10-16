import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  locateManifest,
  MARKETPLACE_MANIFEST_CANDIDATES,
  PLUGIN_MANIFEST_CANDIDATES,
} from './manifest-locate'

/**
 * Shared manifest-locating core: first existing candidate wins, candidate order is
 * the precedence order, and the two callers' candidate lists keep their (opposite)
 * precedences — plugin manifests prefer the ROOT file, marketplace catalogs prefer
 * the `.claude-plugin/` file.
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

  it('plugin candidates: root plugin.json wins over .claude-plugin/plugin.json', async () => {
    await touch('.claude-plugin/plugin.json')
    expect(await locateManifest(dir, PLUGIN_MANIFEST_CANDIDATES)).toBe(
      join(dir, '.claude-plugin', 'plugin.json'),
    )
    await touch('plugin.json')
    expect(await locateManifest(dir, PLUGIN_MANIFEST_CANDIDATES)).toBe(join(dir, 'plugin.json'))
  })

  it('marketplace candidates: .claude-plugin/marketplace.json wins over the root file', async () => {
    await touch('marketplace.json')
    expect(await locateManifest(dir, MARKETPLACE_MANIFEST_CANDIDATES)).toBe(
      join(dir, 'marketplace.json'),
    )
    await touch('.claude-plugin/marketplace.json')
    expect(await locateManifest(dir, MARKETPLACE_MANIFEST_CANDIDATES)).toBe(
      join(dir, '.claude-plugin', 'marketplace.json'),
    )
  })
})
