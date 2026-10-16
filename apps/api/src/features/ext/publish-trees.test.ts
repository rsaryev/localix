import { afterEach, expect, spyOn, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { publishExtensionTrees, isExtensionPublicationArtifact } from './publish-trees'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'localix-publish-batch-'))
  roots.push(root)
  const installRoot = join(root, 'installed')
  const trees = ['a', 'b'].map((name) => ({ source: join(root, name), name, replace: true }))
  for (const tree of trees) {
    await fs.mkdir(tree.source)
    await fs.writeFile(join(tree.source, 'version'), 'new')
    await fs.mkdir(join(installRoot, tree.name), { recursive: true })
    await fs.writeFile(join(installRoot, tree.name, 'version'), 'old')
  }
  const version = (name: string) => fs.readFile(join(installRoot, name, 'version'), 'utf8')
  return { root, installRoot, trees, version }
}

test('all preparation completes before any live tree is replaced', async () => {
  const f = await fixture()
  const trees = f.trees.map((tree) => ({
    ...tree,
    prepare: async () => {
      expect(await f.version('a')).toBe('old')
      expect(await f.version('b')).toBe('old')
      if (tree.name === 'b') throw new Error('last preparation rejected')
    },
  }))
  await expect(publishExtensionTrees({ installRoot: f.installRoot, trees })).rejects.toThrow(
    'last preparation rejected',
  )
  expect(await f.version('a')).toBe('old')
  expect(await fs.readdir(f.installRoot)).toEqual(['a', 'b'])
})

test('batch commit sees all new trees; its failure restores every previous tree', async () => {
  const f = await fixture()
  await expect(
    publishExtensionTrees({
      ...f,
      commit: async (directories) => {
        expect(directories).toEqual(['a', 'b'].map((name) => join(f.installRoot, name)))
        expect(await f.version('a')).toBe('new')
        expect(await f.version('b')).toBe('new')
        throw new Error('transaction failed')
      },
    }),
  ).rejects.toThrow('transaction failed')
  expect(await f.version('a')).toBe('old')
  expect(await f.version('b')).toBe('old')
  expect(await fs.readdir(f.installRoot)).toEqual(['a', 'b'])
})

test('restoration continues for other trees when one destination cannot be restored', async () => {
  const f = await fixture()
  const rename = fs.rename.bind(fs)
  const injected = spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (String(from).endsWith('/backup') && to === join(f.installRoot, 'b'))
      throw new Error('restore b failed')
    return rename(from, to)
  })
  try {
    await expect(
      publishExtensionTrees({
        ...f,
        commit: async () => {
          throw new Error('transaction failed')
        },
      }),
    ).rejects.toThrow('previous tree retained')
    expect(await f.version('a')).toBe('old')
    const artifacts = (await fs.readdir(f.installRoot)).filter(isExtensionPublicationArtifact)
    expect(artifacts).toHaveLength(1)
    expect(await fs.readFile(join(f.installRoot, artifacts[0]!, 'backup', 'version'), 'utf8')).toBe(
      'old',
    )
  } finally {
    injected.mockRestore()
  }
})

test('activation failure on a later tree restores already activated trees and the pending backup', async () => {
  const f = await fixture()
  const rename = fs.rename.bind(fs)
  const injected = spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (String(from).endsWith('/tree') && to === join(f.installRoot, 'b'))
      throw new Error('activate b failed')
    return rename(from, to)
  })
  try {
    await expect(publishExtensionTrees(f)).rejects.toThrow('activate b failed')
    expect(await f.version('a')).toBe('old')
    expect(await f.version('b')).toBe('old')
    expect(await fs.readdir(f.installRoot)).toEqual(['a', 'b'])
  } finally {
    injected.mockRestore()
  }
})

test('opposite input orders serialize overlapping batches and retain callback input order', async () => {
  const f = await fixture()
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const events: string[] = []
  const first = publishExtensionTrees({
    ...f,
    commit: async () => {
      events.push('first commit')
      entered.resolve()
      await release.promise
      events.push('first done')
    },
  })
  await entered.promise
  const second = publishExtensionTrees({
    installRoot: f.installRoot,
    trees: [...f.trees].reverse().map((tree) => ({
      ...tree,
      prepare: async () => {
        events.push(`prepare ${tree.name}`)
      },
    })),
    commit: async (directories) => {
      expect(directories).toEqual(['b', 'a'].map((name) => join(f.installRoot, name)))
    },
  })
  release.resolve()
  await Promise.all([first, second])
  expect(events).toEqual(['first commit', 'first done', 'prepare b', 'prepare a'])
})

test('duplicate destinations reject before preparation or commit', async () => {
  const f = await fixture()
  await expect(
    publishExtensionTrees({
      installRoot: f.installRoot,
      trees: [f.trees[0]!, f.trees[0]!],
    }),
  ).rejects.toMatchObject({ code: 'duplicate_extension_destination' })
  expect(await f.version('a')).toBe('old')
  expect(await fs.readdir(f.installRoot)).toEqual(['a', 'b'])
})
