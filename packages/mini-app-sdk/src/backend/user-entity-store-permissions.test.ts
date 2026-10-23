import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { atomicWriteFile } from './file-io'
import { createUserEntityStore } from './user-entity-store'

/**
 * Every store built on this primitive holds user-owned entities AS AUTHORED, and those routinely
 * carry live credentials: a database connection URL with an embedded password
 * (an earlier mini app store stored records as-is), a REST request header with an API key, an
 * exchange key/secret/passphrase.
 *
 * They were written at the process default — 0644 inside a 0755 directory — so any other local
 * account could read them. The mode parameter already existed and `atomicWriteFile`'s own doc
 * explains why it belongs on the temp file rather than a chmod afterwards; two call sites in the
 * repo (the master key, the MCP OAuth store) already passed 0600 while these did not. This pins
 * the fail-safe default so it cannot regress silently: a permission defect is invisible in every
 * functional test.
 */

const dirs: string[] = []
async function scratchDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ues-perm-'))
  dirs.push(dir)
  return dir
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

const modeOf = async (path: string) => (await stat(path)).mode & 0o777

describe('per-user entity snapshots are owner-only', () => {
  test('a written snapshot is 0600 inside a 0700 directory', async () => {
    const root = await scratchDir()
    const dir = join(root, 'db-connections')
    const store = createUserEntityStore<{ id: string; url: string }>({
      dir,
      fileKey: (userId) => userId.replace(/[^A-Za-z0-9_-]/g, '_'),
    })
    await store.create('u1', { id: 'c1', url: 'postgres://user:hunter2@host/db' })

    const file = join(dir, 'u1.json')
    expect(await modeOf(file)).toBe(0o600)
    expect(await modeOf(dir)).toBe(0o700)
    // And it really is the credential-bearing content that just got protected.
    expect(await readFile(file, 'utf8')).toContain('hunter2')
  })

  test('a snapshot an older version left world-readable is REPAIRED on the next write', async () => {
    // `rename` carries the temp file's mode onto the target, so the fix applies to existing files
    // without a chmod window — which is the reason the mode belongs on the temp in the first place.
    //
    // Written EXPLICITLY at 0644 rather than relying on the process default: the previous version
    // of this test asserted "the old behaviour was wider than 0600", which is false under
    // `umask 077` (a hardened host or CI image), where the default already lands at 0600. A review
    // ran the suite that way and it went red for a reason that had nothing to do with the fix.
    const root = await scratchDir()
    const dir = join(root, 'api-requests')
    const file = join(dir, 'u1.json')
    await atomicWriteFile(file, '[]')
    await chmod(file, 0o644)
    expect(await modeOf(file)).toBe(0o644)

    const store = createUserEntityStore<{ id: string; key: string }>({
      dir,
      fileKey: (userId) => userId,
    })
    await store.create('u1', { id: 'r1', key: 'sk-live-abc' })
    expect(await modeOf(file)).toBe(0o600)
  })

  test('an explicit mode NARROWS but cannot widen past the umask', async () => {
    // `writeFile(…, { mode })` applies `mode & ~umask`, so a store asking for 0644 gets 0644 under
    // umask 022 and 0600 under umask 077 — the doc used to promise widening was "visible at the
    // call site", which the OS does not allow. Asserting the intersection keeps this true on every
    // host: the mode is at most what was asked for, and never wider than the default.
    const root = await scratchDir()
    const dir = join(root, 'public')
    const store = createUserEntityStore<{ id: string }>({
      dir,
      fileKey: (userId) => userId,
      mode: 0o644,
    })
    await store.create('u1', { id: 'x' })
    const actual = await modeOf(join(dir, 'u1.json'))
    expect(actual & ~0o644).toBe(0)

    // And WITHOUT the option the default is 0600 regardless of umask, because 0600 only ever
    // narrows — which is the property the security fix actually rests on.
    const strict = createUserEntityStore<{ id: string }>({
      dir: join(root, 'strict'),
      fileKey: (userId) => userId,
    })
    await strict.create('u1', { id: 'x' })
    expect(await modeOf(join(root, 'strict', 'u1.json'))).toBe(0o600)
  })

  test('atomicWriteFile without a mode does not TIGHTEN the directory', async () => {
    // The 0700 only comes with a requested file mode: tightening a directory a caller shares
    // deliberately would be a behaviour change nobody asked for. Asserted as "no narrower than the
    // process default" rather than "not 0700", which is what umask 077 already produces.
    const root = await scratchDir()
    const plain = join(root, 'plain')
    await atomicWriteFile(join(plain, 'f.json'), '{}')
    const reference = join(root, 'reference')
    await mkdir(reference)
    expect(await modeOf(plain)).toBe(await modeOf(reference))
  })
})

describe('an existing snapshot is repaired on READ, not only on write', () => {
  test('a 0644 file left by an older version is narrowed when it is next read', async () => {
    // `persist` repairs on write, so a user who saves one connection and never edits it again kept
    // a world-readable file holding a live password indefinitely — the database got repair-on-open
    // for exactly this reason, and a review pointed out the stores did not match.
    const root = await scratchDir()
    const dir = join(root, 'db-connections')
    const file = join(dir, 'u1.json')
    await atomicWriteFile(file, JSON.stringify([{ id: 'c1', url: 'postgres://u:pw@h/d' }]))
    await chmod(file, 0o644)

    const store = createUserEntityStore<{ id: string; url: string }>({
      dir,
      fileKey: (userId) => userId,
    })
    const list = await store.list('u1')
    expect(list).toHaveLength(1) // the read still works
    expect(await modeOf(file)).toBe(0o600)
  })

  test('a missing file is not an error and needs no repair', async () => {
    const root = await scratchDir()
    const store = createUserEntityStore<{ id: string }>({
      dir: join(root, 'empty'),
      fileKey: (userId) => userId,
    })
    expect(await store.list('nobody')).toEqual([])
  })
})
