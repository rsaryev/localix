/**
 * Writing a judged zip (`extractZipMembers`) holds every entry inside the destination by where it
 * really lands, not only by its spelling: a link already written can make a later entry's parent
 * resolve elsewhere, and on a case-insensitive file system (macOS APFS) `a/` is the link `A`. The
 * extractor refuses such an entry itself, without relying on the kit's scan having caught it.
 */
import { expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest } from '@localixai/testing'

import { errorMessage } from '../../lib/errors'
import { CASE_COLLISION_LINKS, makeZip, type ZipFixtureEntry } from '../../testing/zip-fixture'
import { extractZipMembers } from './marketplace-zip-extract'
import { scanZip } from './marketplace-zip-scan'

const dir = tempDirPerTest('zip-extract-')
const LINK = 0o120777

async function extract(entries: ZipFixtureEntry[]) {
  const base = dir()
  const dest = join(base, 'plugin')
  const zip = makeZip(entries)
  const outcome = await extractZipMembers(zip, scanZip(zip).members, '', dest).then(
    () => undefined,
    (err: unknown) => errorMessage(err),
  )
  return { base, dest, outcome }
}

/** Every entry under `dir`, never entering a link: a recursive `readdir` follows `A -> .` for ever. */
async function entriesUnder(dir: string, rel = ''): Promise<string[]> {
  const entries = await fs.readdir(join(dir, rel), { withFileTypes: true })
  const below = await Promise.all(
    entries.map(async (entry) => {
      const name = join(rel, entry.name)
      return entry.isDirectory() ? [name, ...(await entriesUnder(dir, name))] : [name]
    }),
  )
  return below.flat()
}

/** Every link under `dest` that resolves, resolves inside it. */
async function linksResolvingOutside(dest: string): Promise<string[]> {
  const realDest = await fs.realpath(dest).catch(() => undefined)
  if (realDest === undefined) return []
  const names = await entriesUnder(dest)
  const outside: string[] = []
  for (const name of names) {
    const real = await fs.realpath(join(dest, name)).catch(() => undefined)
    if (real !== undefined && real !== realDest && !real.startsWith(`${realDest}/`))
      outside.push(name)
  }
  return outside
}

test('a later link whose parent resolves through an earlier link out of the plugin is refused', async () => {
  const { base, outcome } = await extract([
    { name: 'up', data: '..', unixMode: LINK },
    { name: 'up/planted-outside/file.txt', data: 'x', unixMode: LINK },
  ])
  expect(outcome).toContain('outside the plugin')
  expect(await fs.readdir(base)).toEqual(['plugin'])
})

test('a link whose target really resolves out of the plugin is refused', async () => {
  const { base, outcome } = await extract([
    { name: 'here', data: '.', unixMode: LINK },
    { name: 'sub/out', data: '../here/..', unixMode: LINK },
  ])
  expect(outcome).toContain('outside the plugin')
  expect(await fs.readdir(base)).toEqual(['plugin'])
})

test('a link that points out of the plugin at nothing yet is refused all the same', async () => {
  const { base, outcome } = await extract([
    { name: 'here', data: '.', unixMode: LINK },
    { name: 'sub/out', data: '../here/../outside-secret', unixMode: LINK },
  ])
  expect(outcome).toContain('outside the plugin')
  expect(await fs.readdir(base)).toEqual(['plugin'])
})

test('a case-colliding link chain plants nothing outside the destination', async () => {
  const { base, dest, outcome } = await extract([
    { name: 'skills/x.md', data: 'PLANTED' },
    ...CASE_COLLISION_LINKS,
  ])
  // Case-insensitive (macOS): `a/B` lands beside `A` and points out, so the zip is refused.
  // Case-sensitive (Linux): `a/` and `b/` are folders of their own and everything stays inside.
  expect(await fs.readdir(base)).toEqual(['plugin'])
  if (outcome === undefined) expect(await linksResolvingOutside(dest)).toEqual([])
  else expect(outcome).toContain('outside the plugin')
})

test('links that stay inside are still written', async () => {
  const { dest, outcome } = await extract([
    { name: 'skills/fmt/SKILL.md', data: 'fmt' },
    { name: 'skills/alias', data: 'fmt', unixMode: LINK },
    { name: 'top', data: 'skills/alias', unixMode: LINK },
  ])
  expect(outcome).toBeUndefined()
  expect(await fs.readFile(join(dest, 'top/SKILL.md'), 'utf8')).toBe('fmt')
})
