import { afterEach, expect, spyOn, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { publishExtensionTree, isExtensionPublicationArtifact } from './publish-tree'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'localix-publish-tree-'))
  roots.push(root)
  const source = join(root, 'source')
  const installRoot = join(root, 'installed')
  const destination = join(installRoot, 'sample')
  await fs.mkdir(source)
  await fs.mkdir(destination, { recursive: true })
  await fs.writeFile(join(source, 'new.txt'), 'new')
  await fs.writeFile(join(destination, 'old.txt'), 'old')
  return {
    root,
    source,
    installRoot,
    destination,
    input: { source, installRoot, name: 'sample', replace: true },
  }
}

test('preparation sees the private copy while the working tree stays intact', async () => {
  const { input, destination, installRoot } = await fixture()
  await expect(
    publishExtensionTree({
      ...input,
      prepare: async (staged) => {
        expect(await fs.readFile(join(staged, 'new.txt'), 'utf8')).toBe('new')
        expect(await fs.readFile(join(destination, 'old.txt'), 'utf8')).toBe('old')
        throw new Error('invalid artifact')
      },
    }),
  ).rejects.toThrow('invalid artifact')
  expect(await fs.readdir(destination)).toEqual(['old.txt'])
  expect(await fs.readdir(installRoot)).toEqual(['sample'])
})

test('successful replacement publishes one complete tree and removes its private workspace', async () => {
  const { input, destination, installRoot } = await fixture()
  expect(await publishExtensionTree(input)).toBe(destination)
  expect(await fs.readdir(destination)).toEqual(['new.txt'])
  expect(await fs.readdir(installRoot)).toEqual(['sample'])
})

test('failure to activate a prepared tree restores the previous tree', async () => {
  const { input, destination, installRoot } = await fixture()
  const rename = fs.rename.bind(fs)
  const injected = spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (String(from).endsWith('/tree') && to === destination)
      throw new Error('injected activation failure')
    return rename(from, to)
  })
  try {
    await expect(publishExtensionTree(input)).rejects.toThrow('injected activation failure')
    expect(await fs.readFile(join(destination, 'old.txt'), 'utf8')).toBe('old')
    expect(await fs.readdir(installRoot)).toEqual(['sample'])
  } finally {
    injected.mockRestore()
  }
})

test('failed restoration retains the backup instead of deleting the last working version', async () => {
  const { input, destination, installRoot } = await fixture()
  const rename = fs.rename.bind(fs)
  const injected = spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (to === destination) throw new Error('injected destination failure')
    return rename(from, to)
  })
  try {
    await expect(publishExtensionTree(input)).rejects.toThrow('previous tree retained')
    const workspace = (await fs.readdir(installRoot)).find(isExtensionPublicationArtifact)
    expect(workspace).toBeDefined()
    expect(await fs.readFile(join(installRoot, workspace!, 'backup', 'old.txt'), 'utf8')).toBe(
      'old',
    )
  } finally {
    injected.mockRestore()
  }
})

test('concurrent first installations cannot replace each other', async () => {
  const { input, destination, installRoot } = await fixture()
  await fs.rm(destination, { recursive: true })
  const results = await Promise.allSettled([
    publishExtensionTree({ ...input, replace: false }),
    publishExtensionTree({ ...input, replace: false }),
  ])
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  expect(await fs.readdir(destination)).toEqual(['new.txt'])
  expect(await fs.readdir(installRoot)).toEqual(['sample'])
})

test('invalid names and unavailable sources never replace the working tree', async () => {
  const { input, destination, root } = await fixture()
  await expect(publishExtensionTree({ ...input, name: '../escape' })).rejects.toThrow(
    'one path segment',
  )
  await expect(publishExtensionTree({ ...input, source: join(root, 'missing') })).rejects.toThrow()
  expect(await fs.readFile(join(destination, 'old.txt'), 'utf8')).toBe('old')
})

test('failed state commit restores the previous tree and removes a rejected first installation', async () => {
  const { input, destination, installRoot } = await fixture()
  const commit = async (published: string) => {
    expect(await fs.readFile(join(published, 'new.txt'), 'utf8')).toBe('new')
    throw new Error('state commit failed')
  }
  await expect(publishExtensionTree({ ...input, commit })).rejects.toThrow('state commit failed')
  expect(await fs.readdir(destination)).toEqual(['old.txt'])
  await fs.rm(destination, { recursive: true })
  await expect(publishExtensionTree({ ...input, commit })).rejects.toThrow('state commit failed')
  expect(await fs.readdir(installRoot)).toEqual([])
})

test('rollback preserves an independently replaced destination and retains the backup', async () => {
  const { input, destination, installRoot, root } = await fixture()
  await expect(
    publishExtensionTree({
      ...input,
      commit: async () => {
        await fs.rename(destination, join(root, 'external-move'))
        await fs.mkdir(destination)
        await fs.writeFile(join(destination, 'external.txt'), 'external')
        throw new Error('state commit failed')
      },
    }),
  ).rejects.toThrow('previous tree retained')
  expect(await fs.readdir(destination)).toEqual(['external.txt'])
  const workspace = (await fs.readdir(installRoot)).find(isExtensionPublicationArtifact)!
  expect(await fs.readFile(join(installRoot, workspace, 'backup', 'old.txt'), 'utf8')).toBe('old')
})

test('the publication lock spans state commit and is shared by symlink aliases', async () => {
  const { input, destination, installRoot, root } = await fixture()
  const alias = join(root, 'alias')
  await fs.symlink(installRoot, alias)
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const events: string[] = []
  const first = publishExtensionTree({
    ...input,
    commit: async () => {
      events.push('first commit')
      entered.resolve()
      await release.promise
      events.push('first rejected')
      throw new Error('rejected')
    },
  })
  const firstResult = first.catch((error: unknown) => error)
  await entered.promise
  const second = publishExtensionTree({
    ...input,
    installRoot: alias,
    prepare: async () => {
      events.push('second prepare')
      expect(await fs.readdir(destination)).toEqual(['old.txt'])
    },
  })
  release.resolve()
  expect(await firstResult).toMatchObject({ message: 'rejected' })
  await second
  expect(events).toEqual(['first commit', 'first rejected', 'second prepare'])
})
