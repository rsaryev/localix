import { expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest } from '@localixai/testing'

import { publishExtensionTrees } from '../ext/publish-trees'
import { withPluginSource } from './install-helpers'
import {
  addMarketplace,
  resolveMarketplaceInstall,
  type MarketplaceRegistryDeps,
} from './marketplace-registry'

// Claude Code's marketplace symlink rules, end to end: a local marketplace is materialized,
// one of its plugins resolved, then published into an install root.

const tempDir = tempDirPerTest('mkt-symlinks-')

const write = async (path: string, text: string) => {
  await fs.mkdir(join(path, '..'), { recursive: true })
  await fs.writeFile(path, text)
}

async function fixture() {
  const upstream = join(tempDir(), 'upstream')
  const outside = join(tempDir(), 'outside')
  const plugin = join(upstream, 'plugins', 'meta')
  await write(join(outside, 'secret'), 'secret')
  await write(
    join(upstream, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'acme',
      owner: { name: 'acme' },
      plugins: [{ name: 'meta', source: './plugins/meta' }],
    }),
  )
  await write(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'meta' }))
  await write(join(plugin, 'docs', 'guide.md'), 'own guide')
  await write(join(upstream, 'plugins', 'shared', 'skills', 'foo', 'SKILL.md'), 'shared skill')
  await fs.mkdir(join(plugin, 'skills'), { recursive: true })
  await fs.symlink('../docs', join(plugin, 'skills', 'docs'), 'dir')
  await fs.symlink('../../shared/skills/foo', join(plugin, 'skills', 'foo'), 'dir')
  await fs.symlink(join(outside, 'secret'), join(plugin, 'absolute-secret'), 'file')
  await fs.symlink('../../../outside', join(upstream, 'outside-dir'), 'dir')
  const deps: MarketplaceRegistryDeps = {
    root: join(tempDir(), 'marketplaces'),
    localixDir: join(tempDir(), 'bundled'),
    now: () => '2026-01-01T00:00:00.000Z',
    cloneRepo: async () => {
      throw new Error('no network in this test')
    },
  }
  return { upstream, deps }
}

test('a local marketplace keeps only the links that resolve inside it', async () => {
  const { upstream, deps } = await fixture()
  await addMarketplace({ source: 'local', path: upstream }, deps)
  const installed = join(deps.root!, 'acme')

  expect(await fs.readlink(join(installed, 'plugins', 'meta', 'skills', 'foo'))).toBe(
    '../../shared/skills/foo',
  )
  expect(await fs.lstat(join(installed, 'outside-dir')).catch(() => null)).toBeNull()
  expect(
    await fs.lstat(join(installed, 'plugins', 'meta', 'absolute-secret')).catch(() => null),
  ).toBeNull()
})

test('installing a marketplace plugin dereferences links into the marketplace', async () => {
  const { upstream, deps } = await fixture()
  await addMarketplace({ source: 'local', path: upstream }, deps)
  const resolved = await resolveMarketplaceInstall({ plugin: 'meta', marketplace: 'acme' }, deps)
  expect(resolved.linkRoot).toBe(join(deps.root!, 'acme'))

  const installRoot = join(tempDir(), 'plugins')
  const [destination] = await withPluginSource(
    {
      source: resolved.dir,
      installRoot,
      nameOverride: resolved.entry.name,
      linkRoot: resolved.linkRoot,
    },
    (parent) =>
      publishExtensionTrees({
        installRoot,
        trees: [{ source: parent.directory, name: parent.name, linkRoot: parent.linkRoot }],
      }),
  )

  const foo = join(destination!, 'skills', 'foo')
  expect((await fs.lstat(foo)).isDirectory()).toBe(true)
  expect(await fs.readFile(join(foo, 'SKILL.md'), 'utf8')).toBe('shared skill')
  expect(await fs.readlink(join(destination!, 'skills', 'docs'))).toBe('../docs')
  expect(await fs.readFile(join(destination!, 'skills', 'docs', 'guide.md'), 'utf8')).toBe(
    'own guide',
  )
})

test('a marketplace plugin whose path links out of the marketplace is not installed', async () => {
  const { upstream, deps } = await fixture()
  await addMarketplace({ source: 'local', path: upstream }, deps)
  // A git marketplace is cloned verbatim, so `./plugins/meta` can itself be a link out of it.
  const outside = join(tempDir(), 'outside')
  await write(join(outside, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'meta' }))
  const entry = join(deps.root!, 'acme', 'plugins', 'meta')
  await fs.rm(entry, { recursive: true })
  await fs.symlink(outside, entry, 'dir')
  const resolved = await resolveMarketplaceInstall({ plugin: 'meta', marketplace: 'acme' }, deps)

  const installRoot = join(tempDir(), 'plugins')
  await expect(
    withPluginSource(
      { source: resolved.dir, installRoot, nameOverride: 'meta', linkRoot: resolved.linkRoot },
      (parent) =>
        publishExtensionTrees({
          installRoot,
          trees: [{ source: parent.directory, name: parent.name, linkRoot: parent.linkRoot }],
        }),
    ),
  ).rejects.toThrow('is or traverses a symlink')
  expect(await fs.lstat(join(installRoot, 'meta', 'secret')).catch(() => null)).toBeNull()
})
