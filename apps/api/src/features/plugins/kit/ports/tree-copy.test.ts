import { expect, test } from 'bun:test'
import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest } from '@localixai/testing'

import { copyPluginTree } from './tree-copy'

// Claude Code's copy of a plugin into its cache (plugins/host-marketplace.md, "Share files within a
// marketplace with symlinks"), decided by the kit's `planTreeCopy` and applied here.

const tempDir = tempDirPerTest('tree-copy-')

const write = async (path: string, text: string) => {
  await fs.mkdir(join(path, '..'), { recursive: true })
  await fs.writeFile(path, text)
}
const absent = async (path: string) => (await fs.lstat(path).catch(() => null)) === null

test('copies a plugin whole, prebuilt server and dependencies included, skipping only VCS', async () => {
  const source = join(tempDir(), 'plugin')
  const destination = join(tempDir(), 'installed')
  await write(join(source, 'server', 'dist', 'index.js'), 'console.log("mcp")')
  await write(join(source, 'node_modules', 'dep', 'index.js'), 'module.exports = 1')
  await write(join(source, '.env.example'), 'TOKEN=')
  await write(join(source, 'bin', 'tool'), '#!/bin/sh\necho hi')
  await fs.chmod(join(source, 'bin', 'tool'), 0o755)
  await write(join(source, 'private', 'notes.md'), 'n')
  await fs.chmod(join(source, 'private'), 0o700)
  for (const vcs of ['.git', '.svn', '.bzr']) await write(join(source, vcs, 'config'), '[core]')
  await write(join(source, 'nested', '.hg', 'store'), 'x')

  await copyPluginTree(source, destination)

  for (const kept of ['server/dist/index.js', 'node_modules/dep/index.js', '.env.example'])
    expect(existsSync(join(destination, kept))).toBe(true)
  expect((await fs.stat(join(destination, 'bin', 'tool'))).mode & 0o111).toBe(0o111)
  expect((await fs.stat(join(destination, 'private'))).mode & 0o777).toBe(0o700)
  expect(await fs.readFile(join(destination, 'private', 'notes.md'), 'utf8')).toBe('n')
  for (const vcs of ['.git', '.svn', '.bzr', 'nested/.hg'])
    expect(existsSync(join(destination, vcs))).toBe(false)
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
  await fs.symlink(outside, join(plugin, 'outside-dir'), 'dir')
  await fs.symlink('./missing', join(plugin, 'dangling'), 'file')
  return { marketplace, plugin, outside }
}

test('marketplace links: kept inside the plugin, dereferenced inside the marketplace, else skipped', async () => {
  const { marketplace, plugin } = await marketplaceFixture()
  const destination = join(tempDir(), 'installed')

  await copyPluginTree(plugin, destination, { linkRoot: marketplace })

  const docs = join(destination, 'skills', 'docs')
  expect((await fs.lstat(docs)).isSymbolicLink()).toBe(true)
  expect(await fs.readlink(docs)).toBe('../docs')
  expect(await fs.readFile(join(docs, 'guide.md'), 'utf8')).toBe('own guide')

  const foo = join(destination, 'skills', 'foo')
  expect((await fs.lstat(foo)).isDirectory()).toBe(true)
  expect(await fs.readFile(join(foo, 'SKILL.md'), 'utf8')).toBe('shared skill')
  expect((await fs.lstat(join(destination, 'NOTICE'))).isFile()).toBe(true)
  expect(await fs.readFile(join(destination, 'NOTICE'), 'utf8')).toBe('notice')

  for (const skipped of ['relative-secret', 'absolute-secret', 'outside-dir', 'dangling'])
    expect(await absent(join(destination, skipped))).toBe(true)
})

test('a local-path install keeps only links that stay inside the plugin', async () => {
  const { plugin } = await marketplaceFixture()
  const destination = join(tempDir(), 'installed')

  await copyPluginTree(plugin, destination)

  expect((await fs.lstat(join(destination, 'skills', 'docs'))).isSymbolicLink()).toBe(true)
  for (const skipped of ['skills/foo', 'NOTICE', 'relative-secret', 'absolute-secret', 'dangling'])
    expect(await absent(join(destination, skipped))).toBe(true)
})

test('in a dereferenced directory, a link out of the marketplace is skipped and one inside it is dereferenced', async () => {
  const { marketplace, plugin, outside } = await marketplaceFixture()
  const foo = join(marketplace, 'plugins', 'shared', 'skills', 'foo')
  await fs.symlink(join(outside, 'secret'), join(foo, 'secret'), 'file')
  await fs.symlink(outside, join(foo, 'outside-dir'), 'dir')
  await fs.symlink('../../../../NOTICE', join(foo, 'NOTICE'), 'file')
  await fs.symlink('../../../../plugins/meta/docs', join(foo, 'own-docs'), 'dir')
  const destination = join(tempDir(), 'installed')

  await copyPluginTree(plugin, destination, { linkRoot: marketplace })

  const copied = join(destination, 'skills', 'foo')
  expect(await absent(join(copied, 'secret'))).toBe(true)
  expect(await absent(join(copied, 'outside-dir'))).toBe(true)
  expect((await fs.lstat(join(copied, 'NOTICE'))).isFile()).toBe(true)
  expect(await fs.readFile(join(copied, 'NOTICE'), 'utf8')).toBe('notice')
  // A link back into the plugin stays a link, relative from where it lands in the copy.
  expect(await fs.readlink(join(copied, 'own-docs'))).toBe('../../docs')
  expect(await fs.readFile(join(copied, 'own-docs', 'guide.md'), 'utf8')).toBe('own guide')
})

test('links to the marketplace root, the plugin parent, or back from a sibling are skipped as cycles', async () => {
  const marketplace = join(tempDir(), 'market')
  const plugin = join(marketplace, 'plugins', 'meta')
  const shared = join(marketplace, 'shared')
  await write(join(shared, 'a.md'), 'a')
  await fs.symlink('..', join(shared, 'up'), 'dir')
  await fs.symlink('.', join(shared, 'self'), 'dir')
  await fs.symlink('../plugins', join(shared, 'plugins'), 'dir')
  await fs.mkdir(plugin, { recursive: true })
  await fs.symlink('../..', join(plugin, 'root'), 'dir')
  await fs.symlink('..', join(plugin, 'parent'), 'dir')
  await fs.symlink('../../shared', join(plugin, 'shared'), 'dir')
  const destination = join(tempDir(), 'installed')

  await copyPluginTree(plugin, destination, { linkRoot: marketplace })

  expect(await absent(join(destination, 'root'))).toBe(true)
  expect(await absent(join(destination, 'parent'))).toBe(true)
  expect(await fs.readFile(join(destination, 'shared', 'a.md'), 'utf8')).toBe('a')
  for (const cycle of ['up', 'self', 'plugins'])
    expect(await absent(join(destination, 'shared', cycle))).toBe(true)
})

test('two links to one marketplace directory are both real copies', async () => {
  const marketplace = join(tempDir(), 'market')
  const plugin = join(marketplace, 'plugins', 'meta')
  await write(join(marketplace, 'shared', 'file.md'), 'shared')
  await fs.mkdir(plugin, { recursive: true })
  await fs.symlink('../../shared', join(plugin, 'one'), 'dir')
  await fs.symlink('../../shared', join(plugin, 'two'), 'dir')
  const destination = join(tempDir(), 'installed')

  await copyPluginTree(plugin, destination, { linkRoot: marketplace })

  for (const name of ['one', 'two']) {
    expect((await fs.lstat(join(destination, name))).isDirectory()).toBe(true)
    expect((await fs.lstat(join(destination, name, 'file.md'))).isFile()).toBe(true)
    expect(await fs.readFile(join(destination, name, 'file.md'), 'utf8')).toBe('shared')
  }
})

/** `width` links in `level0` to `level1`, which holds `width` files: width² entries brought in. */
async function fanOutFixture(width: number) {
  const marketplace = join(tempDir(), 'market')
  const plugin = join(marketplace, 'plugins', 'fan')
  for (let i = 0; i < width; i++) await write(join(marketplace, 'level1', `f${i}`), 'x')
  await fs.mkdir(join(marketplace, 'level0'), { recursive: true })
  for (let i = 0; i < width; i++)
    await fs.symlink('../level1', join(marketplace, 'level0', `l${i}`), 'dir')
  await fs.mkdir(plugin, { recursive: true })
  await fs.symlink('../../level0', join(plugin, 'shared'), 'dir')
  return { marketplace, plugin }
}

test('links that fan out over several levels are refused past 20,000 entries, writing nothing', async () => {
  const { marketplace, plugin } = await fanOutFixture(150)
  const destination = join(tempDir(), 'installed')

  await expect(copyPluginTree(plugin, destination, { linkRoot: marketplace })).rejects.toThrow(
    '20,000 entries',
  )
  expect(existsSync(destination)).toBe(false)
})

test('a fan-out under the limit is copied in full', async () => {
  const { marketplace, plugin } = await fanOutFixture(4)
  const destination = join(tempDir(), 'installed')

  await copyPluginTree(plugin, destination, { linkRoot: marketplace })

  expect(await fs.readFile(join(destination, 'shared', 'l3', 'f3'), 'utf8')).toBe('x')
})

test('many links to one large marketplace file are refused past 256 MiB', async () => {
  const marketplace = join(tempDir(), 'market')
  const plugin = join(marketplace, 'plugins', 'fan')
  await fs.mkdir(plugin, { recursive: true })
  await fs.writeFile(join(marketplace, 'blob.bin'), Buffer.alloc(2 * 1024 * 1024))
  for (let i = 0; i < 129; i++) await fs.symlink('../../blob.bin', join(plugin, `f${i}`), 'file')
  const destination = join(tempDir(), 'installed')

  await expect(copyPluginTree(plugin, destination, { linkRoot: marketplace })).rejects.toThrow(
    '256 MiB',
  )
  expect(existsSync(destination)).toBe(false)
})

test('a link root that does not contain the plugin is refused, not widened', async () => {
  const { plugin } = await marketplaceFixture()
  const destination = join(tempDir(), 'installed')

  await expect(
    copyPluginTree(plugin, destination, { linkRoot: join(tempDir(), 'outside') }),
  ).rejects.toThrow('does not stay inside its marketplace directory')
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
    await expect(copyPluginTree(source, destination, { linkRoot: marketplace })).rejects.toThrow(
      `Plugin source path refused: ${source} does not stay inside its marketplace directory`,
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

  await copyPluginTree(join(marketplace, 'plugins', 'meta'), destination, {
    linkRoot: marketplace,
  })

  expect(await fs.readFile(join(destination, 'a.md'), 'utf8')).toBe('a')
})
