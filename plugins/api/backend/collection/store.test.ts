import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { RequestSpec } from '../request-spec'
import { createCollectionStore, type CollectionStore } from './store'

/**
 * A real directory, because every claim here is about the filesystem: that folders appear from
 * names, that an empty one is pruned, that a colleague's `git pull` is picked up without an index
 * to invalidate. A fake fs would agree with whatever this code does.
 *
 * `DRIVER TESTS USE IN-WORKSPACE PATHS` does not apply — these are pure temp dirs with no HITL
 * gate, and the repo's own store tests do the same.
 */
let root: string
let store: CollectionStore

const spec = (url: string): RequestSpec => ({
  url,
  method: 'GET',
  headers: [],
  query: [],
  auth: { type: 'none' },
})

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'localix-api-collection-'))
  store = createCollectionStore(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('the tree falls out of the names', () => {
  test('a name with slashes creates the folders', async () => {
    const saved = await store.save('users/admin/list', spec('https://api.dev/users'))
    expect(saved.ok).toBe(true)
    expect(await Bun.file(path.join(root, 'users/admin/list.request.json')).exists()).toBe(true)
  })

  test('a request at the root sits at the root', async () => {
    await store.save('ping', spec('https://api.dev/ping'))
    expect(await Bun.file(path.join(root, 'ping.request.json')).exists()).toBe(true)
  })

  test('the listing is sorted, so the tree does not reshuffle between renders', async () => {
    await store.save('zeta', spec('https://api.dev/z'))
    await store.save('alpha/one', spec('https://api.dev/a'))
    await store.save('alpha/two', spec('https://api.dev/b'))
    expect((await store.list()).map((r) => r.name)).toEqual(['alpha/one', 'alpha/two', 'zeta'])
  })

  test('an empty folder is a real collection node', async () => {
    expect(await store.createFolder?.('users/admin')).toEqual({ ok: true, name: 'users/admin' })
    expect(await store.listFolders?.()).toEqual(['users', 'users/admin'])
  })

  test('the environments directory is not exposed as a request folder', async () => {
    await mkdir(path.join(root, 'environments'), { recursive: true })
    expect(await store.listFolders?.()).toEqual([])
    expect((await store.createFolder?.('environments/private'))?.ok).toBe(false)
  })
})

describe('the directory IS the index', () => {
  test('a file dropped in by hand — a `git pull`, a colleague, an editor — is found', async () => {
    // The reason there is no index file: nothing here needs invalidating.
    await mkdir(path.join(root, 'team'), { recursive: true })
    await writeFile(
      path.join(root, 'team/shared.request.json'),
      JSON.stringify({
        localixRestRequest: 1,
        name: 'whatever-the-file-says',
        spec: spec('https://api.dev/shared'),
      }),
    )
    const found = await store.list()
    expect(found.map((r) => r.name)).toEqual(['team/shared'])
  })

  test('the PATH wins over the name written inside the file', async () => {
    // They can disagree after a rename in the user's editor. The path is what the tree, the URIs
    // and the history key already agree on.
    await writeFile(
      path.join(root, 'renamed.request.json'),
      JSON.stringify({ localixRestRequest: 1, name: 'old-name', spec: spec('https://api.dev/x') }),
    )
    expect((await store.get('renamed'))?.name).toBe('renamed')
  })

  test('a malformed file is skipped, not fatal for the rest of the collection', async () => {
    await store.save('good', spec('https://api.dev/good'))
    await writeFile(path.join(root, 'broken.request.json'), '{ not json')
    expect((await store.list()).map((r) => r.name)).toEqual(['good'])
  })

  test('a non-request file in the collection is ignored', async () => {
    await store.save('good', spec('https://api.dev/good'))
    await writeFile(path.join(root, 'README.md'), '# how to use these')
    expect((await store.list()).map((r) => r.name)).toEqual(['good'])
  })

  test('a missing collection lists empty rather than throwing', async () => {
    const absent = createCollectionStore(path.join(root, 'nope'))
    expect(await absent.list()).toEqual([])
  })

  test('a valid legacy .json request is discovered and atomically migrated', async () => {
    await writeFile(
      path.join(root, 'legacy.json'),
      JSON.stringify({ localixRestRequest: 1, name: 'legacy', spec: spec('https://api.dev/old') }),
    )
    expect((await store.list()).map((request) => request.name)).toEqual(['legacy'])
    expect(await Bun.file(path.join(root, 'legacy.request.json')).exists()).toBe(true)
    expect(await Bun.file(path.join(root, 'legacy.json')).exists()).toBe(false)
  })

  test('a generic JSON document is ignored and not renamed', async () => {
    await writeFile(path.join(root, 'notes.json'), JSON.stringify({ note: 'not a request' }))
    expect(await store.list()).toEqual([])
    expect(await Bun.file(path.join(root, 'notes.json')).exists()).toBe(true)
  })
})

describe('removing', () => {
  test('an emptied folder stays visible until the user removes it', async () => {
    await store.save('users/only', spec('https://api.dev/u'))
    expect(await store.remove('users/only')).toBe(true)
    expect(await store.listFolders?.()).toEqual(['users'])
    expect(await store.removeFolder?.('users')).toEqual({ ok: true })
    expect(await readdir(root)).toEqual([])
  })

  test('a folder with siblings survives', async () => {
    await store.save('users/one', spec('https://api.dev/1'))
    await store.save('users/two', spec('https://api.dev/2'))
    await store.remove('users/one')
    expect((await store.list()).map((r) => r.name)).toEqual(['users/two'])
  })

  test('removing what is not there is false, not an error', async () => {
    expect(await store.remove('ghost')).toBe(false)
  })

  test('folder deletion never recursively removes requests', async () => {
    await store.save('users/one', spec('https://api.dev/1'))
    const outcome = await store.removeFolder?.('users')
    expect(outcome?.ok).toBe(false)
    expect(await store.get('users/one')).not.toBeNull()
  })
})

describe('renaming moves the file', () => {
  test('into another folder, keeping the spec', async () => {
    await store.save('draft', spec('https://api.dev/thing'))
    const moved = await store.rename('draft', 'users/thing')
    expect(moved.ok).toBe(true)
    expect((await store.list()).map((r) => r.name)).toEqual(['users/thing'])
    expect((await store.get('users/thing'))?.spec.url).toBe('https://api.dev/thing')
  })

  test('onto a taken name is refused, and neither request is touched', async () => {
    await store.save('a', spec('https://api.dev/a'))
    await store.save('b', spec('https://api.dev/b'))
    const clash = await store.rename('a', 'b')
    expect(clash.ok).toBe(false)
    expect((await store.get('a'))?.spec.url).toBe('https://api.dev/a')
    expect((await store.get('b'))?.spec.url).toBe('https://api.dev/b')
  })

  test('renaming something absent says so', async () => {
    expect(await store.rename('ghost', 'x')).toEqual({
      ok: false,
      problem: 'No saved request named "ghost".',
    })
  })
})

describe('what may not be written', () => {
  test('a literal credential is REFUSED — git history is forever', async () => {
    const withToken: RequestSpec = {
      ...spec('https://api.dev/x'),
      auth: { type: 'bearer', token: 'ghp_a_real_looking_token' },
    }
    const refused = await store.save('leaky', withToken)
    expect(refused.ok).toBe(false)
    // And nothing was written: the check runs before the write, not after.
    expect(await Bun.file(path.join(root, 'leaky.request.json')).exists()).toBe(false)
  })

  test('a ${secret:KEY} reference writes freely — a pointer is shareable by construction', async () => {
    const withRef: RequestSpec = {
      ...spec('https://api.dev/x'),
      auth: { type: 'bearer', token: '${secret:GITHUB_TOKEN}' },
    }
    expect((await store.save('shared', withRef)).ok).toBe(true)
    const text = await Bun.file(path.join(root, 'shared.request.json')).text()
    expect(text).toContain('${secret:GITHUB_TOKEN}')
  })

  test('a traversing name writes nothing, anywhere', async () => {
    const escaped = await store.save('../../escaped', spec('https://api.dev/x'))
    expect(escaped.ok).toBe(false)
    expect(await Bun.file(path.join(root, '../../escaped.request.json')).exists()).toBe(false)
  })
})
