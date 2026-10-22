import { expect, test } from 'bun:test'
import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest } from '@localixai/testing'

import { copyExtensionTree } from './copy-tree'

const tempDir = tempDirPerTest('copy-tree-')

const write = async (path: string, text: string) => {
  await fs.mkdir(join(path, '..'), { recursive: true })
  await fs.writeFile(path, text)
}

test('copies a plugin whole, prebuilt server and dependencies included, skipping only VCS', async () => {
  const source = join(tempDir(), 'plugin')
  const destination = join(tempDir(), 'installed')
  await write(join(source, 'server', 'dist', 'index.js'), 'console.log("mcp")')
  await write(join(source, 'node_modules', 'dep', 'index.js'), 'module.exports = 1')
  await write(join(source, 'build', 'out.txt'), 'built')
  await write(join(source, 'lib', 'x.egg-info', 'PKG-INFO'), 'meta')
  await write(join(source, '.env.example'), 'TOKEN=')
  await write(join(source, 'bin', 'tool'), '#!/bin/sh\necho hi')
  await fs.chmod(join(source, 'bin', 'tool'), 0o755)
  await write(join(source, '.git', 'config'), '[core]')
  await write(join(source, 'nested', '.hg', 'store'), 'x')

  await copyExtensionTree(source, destination)

  for (const kept of [
    'server/dist/index.js',
    'node_modules/dep/index.js',
    'build/out.txt',
    'lib/x.egg-info/PKG-INFO',
    '.env.example',
  ])
    expect(existsSync(join(destination, kept))).toBe(true)
  expect((await fs.stat(join(destination, 'bin', 'tool'))).mode & 0o111).toBe(0o111)
  expect(existsSync(join(destination, '.git'))).toBe(false)
  expect(existsSync(join(destination, 'nested', '.hg'))).toBe(false)
})

/** A marketplace with one plugin, a sibling plugin, and a directory outside both. */
async function marketplaceFixture() {
  const marketplace = join(tempDir(), 'market')
  const plugin = join(marketplace, 'plugins', 'meta')
  const outside = join(tempDir(), 'outside')
  await write(join(plugin, 'docs', 'guide.md'), 'own guide')
  await write(join(marketplace, 'plugins', 'shared', 'skills', 'foo', 'SKILL.md'), 'shared skill')
  await write(join(marketplace, 'NOTICE'), 'notice')
  await write(join(outside, 'secret'), 'secret')
  await fs.mkdir(join(plugin, 'skills'), { recursive: true })
  // Inside the plugin: kept as a link.
  await fs.symlink('../docs', join(plugin, 'skills', 'docs'), 'dir')
  // Elsewhere in the marketplace: dereferenced.
  await fs.symlink('../../shared/skills/foo', join(plugin, 'skills', 'foo'), 'dir')
  await fs.symlink('../../NOTICE', join(plugin, 'NOTICE'), 'file')
  // Outside the marketplace, relative and absolute, and dangling: skipped.
  await fs.symlink('../../../../outside/secret', join(plugin, 'relative-secret'), 'file')
  await fs.symlink(join(outside, 'secret'), join(plugin, 'absolute-secret'), 'file')
  await fs.symlink(join(outside), join(plugin, 'outside-dir'), 'dir')
  await fs.symlink('./missing', join(plugin, 'dangling'), 'file')
  return { marketplace, plugin }
}

test('marketplace links: kept inside the plugin, dereferenced inside the marketplace, else skipped', async () => {
  const { marketplace, plugin } = await marketplaceFixture()
  const destination = join(tempDir(), 'installed')

  await copyExtensionTree(plugin, destination, { linkRoot: marketplace })

  const docs = join(destination, 'skills', 'docs')
  expect((await fs.lstat(docs)).isSymbolicLink()).toBe(true)
  expect(await fs.readlink(docs)).toBe('../docs')
  expect(await fs.readFile(join(docs, 'guide.md'), 'utf8')).toBe('own guide')

  const foo = join(destination, 'skills', 'foo')
  expect((await fs.lstat(foo)).isDirectory()).toBe(true)
  expect(await fs.readFile(join(foo, 'SKILL.md'), 'utf8')).toBe('shared skill')
  expect((await fs.lstat(join(destination, 'NOTICE'))).isFile()).toBe(true)

  for (const skipped of ['relative-secret', 'absolute-secret', 'outside-dir', 'dangling'])
    expect(await fs.lstat(join(destination, skipped)).catch(() => null)).toBeNull()
})

test('a local-path install keeps only links that stay inside the plugin', async () => {
  const { plugin } = await marketplaceFixture()
  const destination = join(tempDir(), 'installed')

  await copyExtensionTree(plugin, destination)

  expect((await fs.lstat(join(destination, 'skills', 'docs'))).isSymbolicLink()).toBe(true)
  for (const skipped of ['skills/foo', 'NOTICE', 'relative-secret', 'absolute-secret'])
    expect(await fs.lstat(join(destination, skipped)).catch(() => null)).toBeNull()
})

test('a link root that does not contain the plugin is refused, not widened', async () => {
  const { plugin } = await marketplaceFixture()
  const destination = join(tempDir(), 'installed')

  await expect(
    copyExtensionTree(plugin, destination, { linkRoot: join(tempDir(), 'outside') }),
  ).rejects.toThrow('was not read')
  expect(existsSync(destination)).toBe(false)
})

test('a marketplace plugin path that is or traverses a symlink out of the marketplace is refused', async () => {
  const marketplace = join(tempDir(), 'market')
  const outside = join(tempDir(), 'home', '.ssh')
  await write(join(outside, 'id_rsa'), 'private key')
  await fs.mkdir(join(marketplace, 'plugins'), { recursive: true })
  // A git marketplace is cloned verbatim: its entry `./plugins/meta` can be a link out of it.
  await fs.symlink(outside, join(marketplace, 'plugins', 'meta'), 'dir')
  await fs.symlink(join(tempDir(), 'home'), join(marketplace, 'linked'), 'dir')

  for (const source of [
    join(marketplace, 'plugins', 'meta'),
    join(marketplace, 'linked', '.ssh'),
  ]) {
    const destination = join(tempDir(), 'installed')
    await expect(copyExtensionTree(source, destination, { linkRoot: marketplace })).rejects.toThrow(
      `Source ${source} is or traverses a symlink`,
    )
    expect(existsSync(join(destination, 'id_rsa'))).toBe(false)
  }
})

test('a plugin path linked to elsewhere inside its marketplace is still copied', async () => {
  const marketplace = join(tempDir(), 'market')
  await write(join(marketplace, 'real', 'meta', 'a.md'), 'a')
  await fs.mkdir(join(marketplace, 'plugins'), { recursive: true })
  await fs.symlink('../real/meta', join(marketplace, 'plugins', 'meta'), 'dir')
  const destination = join(tempDir(), 'installed')

  await copyExtensionTree(join(marketplace, 'plugins', 'meta'), destination, {
    linkRoot: marketplace,
  })

  expect(await fs.readFile(join(destination, 'a.md'), 'utf8')).toBe('a')
})

test('a dereferenced link cycle copies each directory once and terminates', async () => {
  const marketplace = join(tempDir(), 'market')
  const plugin = join(marketplace, 'plugins', 'meta')
  const shared = join(marketplace, 'shared')
  await write(join(shared, 'a.md'), 'a')
  await fs.symlink('..', join(shared, 'up'), 'dir')
  await fs.mkdir(plugin, { recursive: true })
  await fs.symlink('../../shared', join(plugin, 'shared'), 'dir')

  await copyExtensionTree(plugin, join(tempDir(), 'installed'), { linkRoot: marketplace })

  const copied = join(tempDir(), 'installed', 'shared')
  expect(await fs.readFile(join(copied, 'a.md'), 'utf8')).toBe('a')
  // `up` is the marketplace root: it is dereferenced, but the plugin and `shared` inside it are
  // already being copied, so the cycle stops there.
  expect(existsSync(join(copied, 'up', 'plugins'))).toBe(true)
  expect(existsSync(join(copied, 'up', 'plugins', 'meta'))).toBe(false)
  expect(existsSync(join(copied, 'up', 'shared'))).toBe(false)
})

/** Every directory under `root` that is a real directory, not a link to one. */
async function realDirectories(root: string): Promise<number> {
  let count = 1
  for (const entry of await fs.readdir(root, { withFileTypes: true }))
    if (entry.isDirectory()) count += await realDirectories(join(root, entry.name))
  return count
}

test('links fanning out between shared directories copy each directory once', async () => {
  const marketplace = join(tempDir(), 'market')
  const plugin = join(marketplace, 'plugins', 'meta')
  const names = ['s0', 's1', 's2', 's3', 's4', 's5']
  for (const name of names) await write(join(marketplace, 'shared', name, 'file.md'), name)
  for (const name of names)
    for (const other of names)
      if (other !== name)
        await fs.symlink(`../${other}`, join(marketplace, 'shared', name, other), 'dir')
  await fs.mkdir(plugin, { recursive: true })
  await fs.symlink('../../shared/s0', join(plugin, 'shared'), 'dir')
  const destination = join(tempDir(), 'installed')

  await copyExtensionTree(plugin, destination, { linkRoot: marketplace })

  // The plugin plus the six shared directories; following every path would copy hundreds.
  expect(await realDirectories(destination)).toBe(1 + names.length)
  // A directory reached again links to its first copy, which keeps its content reachable.
  const again = join(destination, 'shared', 's2', 's1')
  expect((await fs.lstat(again)).isSymbolicLink()).toBe(true)
  expect(await fs.realpath(again)).toBe(await fs.realpath(join(destination, 'shared', 's1')))
  expect(await fs.readFile(join(again, 'file.md'), 'utf8')).toBe('s1')
})
