import { afterEach, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { installFromLocal } from './install-helpers'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'localix-plugin-copy-'))
  roots.push(root)
  const source = join(root, 'sample')
  const installRoot = join(root, 'installed')
  const outside = join(root, 'kept')
  await Promise.all([fs.mkdir(source), fs.mkdir(installRoot), fs.mkdir(outside)])
  await fs.writeFile(join(outside, 'keep.txt'), 'keep')
  return { source, installRoot, outside }
}

test('manifest names are validated before deriving or replacing any destination', async () => {
  const { source, installRoot, outside } = await fixture()
  for (const name of ['../kept', '.', '..', outside]) {
    await fs.writeFile(join(source, 'plugin.json'), JSON.stringify({ name }))
    await expect(installFromLocal(source, installRoot, true)).rejects.toThrow('Invalid plugin name')
    expect(await fs.readFile(join(outside, 'keep.txt'), 'utf8')).toBe('keep')
    expect(await fs.readdir(installRoot)).toEqual([])
  }
})

test('an invalid name override is rejected rather than silently using another identity', async () => {
  const { source, installRoot } = await fixture()
  await fs.writeFile(join(source, 'plugin.json'), JSON.stringify({ name: 'sample' }))
  await expect(installFromLocal(source, installRoot, true, '../other')).rejects.toThrow(
    'Invalid plugin name override',
  )
  expect(await fs.readdir(installRoot)).toEqual([])
})

test('local installs publish a complete replacement and preserve conflict behavior', async () => {
  const { source, installRoot } = await fixture()
  await fs.writeFile(join(source, 'plugin.json'), JSON.stringify({ name: 'sample' }))
  const destination = await installFromLocal(source, installRoot)
  await expect(installFromLocal(source, installRoot)).rejects.toMatchObject({
    code: 'plugin_exists',
  })
  await fs.writeFile(join(source, 'new.txt'), 'new')
  expect(await installFromLocal(source, installRoot, true)).toBe(destination)
  expect(await fs.readFile(join(destination, 'new.txt'), 'utf8')).toBe('new')
  expect(await fs.readdir(installRoot)).toEqual(['sample'])
})
