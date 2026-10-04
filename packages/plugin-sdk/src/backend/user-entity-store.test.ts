import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, readdir, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createUserEntityStore } from './user-entity-store'

const roots: string[] = []
async function freshDir(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'localix-user-entity-'))
  roots.push(root)
  return path.join(root, 'entities')
}
afterAll(async () => {
  for (const r of roots) await rm(r, { recursive: true, force: true })
})

interface Conn {
  id: string
  name: string
  /** An OPTIONAL field a later edit may never mention — the merge must preserve it. */
  note?: string
  metadata?: { label: string }
}

/** The allow-list sanitizer every real caller passes. */
const safeKey = (k: string) => k.replace(/[^a-zA-Z0-9_-]/g, '_')

const store = async () => createUserEntityStore<Conn>({ dir: await freshDir(), fileKey: safeKey })

describe('createUserEntityStore — CRUD', () => {
  test('create appends, then replaces in place by id (no duplicate)', async () => {
    const s = await store()
    await s.create('u1', { id: 'a', name: 'first' })
    await s.create('u1', { id: 'b', name: 'second' })
    await s.create('u1', { id: 'a', name: 'first-renamed' })

    expect(await s.list('u1')).toEqual([
      { id: 'a', name: 'first-renamed' },
      { id: 'b', name: 'second' },
    ])
    expect(await s.get('u1', 'a')).toEqual({ id: 'a', name: 'first-renamed' })
    expect(await s.get('u1', 'nope')).toBeNull()
  })

  test('updateById MERGES a patch into the stored entity — absent fields survive', async () => {
    const s = await store()
    await s.create('u1', { id: 'a', name: 'orig', note: 'keep me' })

    // The patch mentions only `name`. `note` is not in the patch, so it must ride along —
    // this is the whole reason the writer takes a patch and not a whole record.
    const merged = await s.updateById('u1', 'a', { name: 'renamed' })

    expect(merged).toEqual({ id: 'a', name: 'renamed', note: 'keep me' })
    expect(await s.get('u1', 'a')).toEqual({ id: 'a', name: 'renamed', note: 'keep me' })
  })

  test('updateById clears a field when the patch sets it to undefined', async () => {
    const s = await store()
    await s.create('u1', { id: 'a', name: 'orig', note: 'temp' })
    await s.updateById('u1', 'a', { note: undefined })
    expect(await s.get('u1', 'a')).toEqual({ id: 'a', name: 'orig' })
  })

  test('updateById on a missing id is a no-op that returns null', async () => {
    const s = await store()
    expect(await s.updateById('u1', 'ghost', { name: 'x' })).toBeNull()
    expect(await s.list('u1')).toEqual([])
  })

  test('remove drops only the matching id; users are isolated', async () => {
    const s = await store()
    await s.create('u1', { id: 'a', name: 'mine' })
    await s.create('u2', { id: 'a', name: 'theirs' })
    await s.remove('u1', 'a')

    expect(await s.list('u1')).toEqual([])
    expect(await s.list('u2')).toEqual([{ id: 'a', name: 'theirs' }])
  })

  test('list returns a COPY — mutating it cannot corrupt the cache', async () => {
    const s = await store()
    await s.create('u1', { id: 'a', name: 'x' })
    const first = await s.list('u1')
    first.push({ id: 'evil', name: 'injected' })

    expect(await s.list('u1')).toEqual([{ id: 'a', name: 'x' }])
  })

  test('returned and input entities do not alias the cache', async () => {
    const s = await store()
    const input: Conn = {
      id: 'a',
      name: 'original',
      metadata: { label: 'safe' },
    }
    await s.create('u1', input)

    input.name = 'mutated input'
    input.metadata!.label = 'mutated input'

    const listed = await s.list('u1')
    listed[0]!.name = 'mutated list'
    listed[0]!.metadata!.label = 'mutated list'

    const fetched = await s.get('u1', 'a')
    expect(fetched).toEqual({
      id: 'a',
      name: 'original',
      metadata: { label: 'safe' },
    })
    fetched!.name = 'mutated get'
    fetched!.metadata!.label = 'mutated get'

    expect(await s.list('u1')).toEqual([
      {
        id: 'a',
        name: 'original',
        metadata: { label: 'safe' },
      },
    ])
  })
})

describe('createUserEntityStore — the read discipline (property 2 + 3)', () => {
  test('ENOENT (no file yet) is a legitimate empty list, not an error', async () => {
    const s = await store()
    expect(await s.list('never-saved')).toEqual([])
    expect(await s.get('never-saved', 'a')).toBeNull()
  })

  test('a NON-ENOENT read error is rethrown and NOT cached, so a later read recovers', async () => {
    const dir = await freshDir()
    const s = createUserEntityStore<Conn>({ dir, fileKey: safeKey })

    // A DIRECTORY where the user's JSON file should be: reading it fails with EISDIR,
    // not ENOENT. Freezing that in as "the user has nothing" is exactly the bug the
    // ENOENT-only branch exists to prevent.
    await mkdir(path.join(dir, 'u1.json'), { recursive: true })
    expect(s.list('u1')).rejects.toThrow()

    // Replace the directory with a real file — the failure must not have been cached.
    await rm(path.join(dir, 'u1.json'), { recursive: true, force: true })
    await writeFile(
      path.join(dir, 'u1.json'),
      JSON.stringify([{ id: 'a', name: 'recovered' }]),
      'utf8',
    )
    expect(await s.list('u1')).toEqual([{ id: 'a', name: 'recovered' }])
  })

  test('a non-array file body degrades to an empty list rather than throwing', async () => {
    const dir = await freshDir()
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'u1.json'), '{"not":"an array"}', 'utf8')

    const s = createUserEntityStore<Conn>({ dir, fileKey: safeKey })
    expect(await s.list('u1')).toEqual([])
  })

  test('LRU-bounds cached user snapshots and reloads an evicted user from disk', async () => {
    const dir = await freshDir()
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'u1.json'), JSON.stringify([{ id: 'a', name: 'v1' }]))
    await writeFile(path.join(dir, 'u2.json'), JSON.stringify([{ id: 'b', name: 'other' }]))
    const s = createUserEntityStore<Conn>({ dir, fileKey: safeKey, maxCachedUsers: 1 })

    expect(await s.list('u1')).toEqual([{ id: 'a', name: 'v1' }])
    await s.list('u2') // evicts u1
    await writeFile(path.join(dir, 'u1.json'), JSON.stringify([{ id: 'a', name: 'v2' }]))
    expect(await s.list('u1')).toEqual([{ id: 'a', name: 'v2' }])
  })

  test('rejects an invalid cache ceiling at construction', async () => {
    const dir = await freshDir()
    expect(() => createUserEntityStore<Conn>({ dir, fileKey: safeKey, maxCachedUsers: 0 })).toThrow(
      'positive safe integer',
    )
  })
})

describe('createUserEntityStore — the write discipline (property 4)', () => {
  test('a failed durable commit leaves the cache unchanged and cleans its temp file', async () => {
    const dir = await freshDir()
    const s = createUserEntityStore<Conn>({ dir, fileKey: safeKey })
    await s.create('u1', { id: 'a', name: 'original' })

    // Turn the target into a directory so the atomic rename fails deterministically.
    // The previously committed cache entry must remain authoritative.
    const target = path.join(dir, 'u1.json')
    await rm(target)
    await mkdir(target)

    expect(s.updateById('u1', 'a', { name: 'uncommitted' })).rejects.toThrow()
    expect(await s.get('u1', 'a')).toEqual({ id: 'a', name: 'original' })
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  test('concurrent creates are serialized — neither edit is clobbered', async () => {
    const s = await store()
    // Fired together, deliberately un-awaited between: without the per-user write lock
    // both would read the same empty list and the second persist would drop the first.
    await Promise.all([
      s.create('u1', { id: 'a', name: 'A' }),
      s.create('u1', { id: 'b', name: 'B' }),
      s.create('u1', { id: 'c', name: 'C' }),
    ])

    const ids = (await s.list('u1')).map((e) => e.id).sort()
    expect(ids).toEqual(['a', 'b', 'c'])
  })

  test('concurrent updateById edits to distinct ids compose — neither is lost', async () => {
    const s = await store()
    await s.create('u1', { id: 'a', name: 'A' })
    await s.create('u1', { id: 'b', name: 'B' })
    await Promise.all([
      s.updateById('u1', 'a', { name: 'A2' }),
      s.updateById('u1', 'b', { name: 'B2' }),
    ])
    expect(await s.list('u1')).toEqual([
      { id: 'a', name: 'A2' },
      { id: 'b', name: 'B2' },
    ])
  })

  test('a concurrent read never observes a partial file (commit is temp+rename)', async () => {
    const dir = await freshDir()
    const s = createUserEntityStore<Conn>({ dir, fileKey: safeKey })
    await s.create('u1', { id: 'a', name: 'A' })

    // Interleave reads with a write. Every read must return a COMPLETE list.
    const writes = s.create('u1', { id: 'b', name: 'B' })
    const reads = Promise.all(Array.from({ length: 20 }, () => s.list('u1')))
    const [, seen] = await Promise.all([writes, reads])

    for (const list of seen) {
      // Never a half-written state: either just 'a', or 'a' + 'b'.
      expect([1, 2]).toContain(list.length)
      expect(list[0]).toEqual({ id: 'a', name: 'A' })
    }
    // And the temp file is never left behind.
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})

describe('createUserEntityStore — fileKey is the traversal boundary', () => {
  test('a crafted userId cannot steer the write out of the store dir', async () => {
    const dir = await freshDir()
    const s = createUserEntityStore<Conn>({ dir, fileKey: safeKey })

    await s.create('../../etc/passwd', { id: 'a', name: 'x' })

    // Everything the store wrote stays inside `dir`, under a sanitized name. Note `.`
    // is outside the allow-list too, so `..` cannot survive even in part.
    const files = await readdir(dir)
    expect(files).toEqual(['______etc_passwd.json'])
    // ...and it round-trips under the ORIGINAL key.
    expect(await s.list('../../etc/passwd')).toEqual([{ id: 'a', name: 'x' }])
  })
})
