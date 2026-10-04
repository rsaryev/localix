import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { promises as fsp, realpathSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { freshModuleUrl, importFreshModule } from './module-url'

// Under the CANONICAL temp path: on macOS `tmpdir()` goes through the `/var` → `/private/var`
// symlink, and Bun cannot import a file created after it cached a directory reached that way —
// the runtime-exception case failed with "Cannot find module" whenever `--randomize` ran it
// after another import in this directory.
const dir = path.join(realpathSync(os.tmpdir()), `localix-module-url-${process.pid}`)
// The scratch directory belongs to the FILE, not to whichever test happened to be
// written first: only one of them used to create it, so `bun test --randomize` failed
// the others with ENOENT.
beforeAll(() => fsp.mkdir(dir, { recursive: true }))
afterAll(() => fsp.rm(dir, { recursive: true, force: true }))

describe('freshModuleUrl', () => {
  test('appends a ?m=<mtimeMs> cache-buster for an existing file', async () => {
    const file = path.join(dir, 'mod.mjs')
    await fsp.writeFile(file, 'export const x = 1')

    const url = freshModuleUrl(file)
    const expected = `${pathToFileURL(file).href}?m=${statSync(file).mtimeMs}`
    expect(url).toBe(expected)
    expect(url.startsWith('file://')).toBe(true)
    expect(url).toContain('?m=')
  })

  test('falls back to the bare file URL when the path cannot be stat-ed', () => {
    const missing = path.join(dir, 'does-not-exist.mjs')
    const url = freshModuleUrl(missing)
    expect(url).toBe(pathToFileURL(missing).href)
    expect(url).not.toContain('?m=')
  })

  test('an edited module that already loaded is imported again with its new code', async () => {
    // Bun keys its module cache by the file's canonical path and ignores the `?m=` query, so the
    // mtime cache-buster alone returned the FIRST version forever: a bundled plugin rebuilt in
    // development kept serving its old backend until the API restarted. The entry's relative
    // imports must keep resolving too — a rebuilt bundle points at new chunk files beside it.
    // Its own directory, so the directories this test makes Bun cache are not the ones the other
    // tests create files in.
    const sub = await fsp.mkdtemp(path.join(os.tmpdir(), 'localix-module-hot-'))
    await fsp.mkdir(path.join(sub, 'chunks'), { recursive: true })
    const entry = path.join(sub, 'entry.mjs')
    await fsp.writeFile(path.join(sub, 'chunks', 'a.mjs'), 'export const part = "a"')
    await fsp.writeFile(entry, 'import { part } from "./chunks/a.mjs"; export const v = "1" + part')
    await fsp.utimes(entry, new Date('2026-08-01T00:00:00Z'), new Date('2026-08-01T00:00:00Z'))
    expect(((await importFreshModule(entry)) as { v: string }).v).toBe('1a')

    await fsp.writeFile(path.join(sub, 'chunks', 'b.mjs'), 'export const part = "b"')
    await fsp.writeFile(entry, 'import { part } from "./chunks/b.mjs"; export const v = "2" + part')
    await fsp.utimes(entry, new Date('2026-08-02T00:00:00Z'), new Date('2026-08-02T00:00:00Z'))
    expect(((await importFreshModule(entry)) as { v: string }).v).toBe('2b')
    // Unchanged since: the same module instance, not another copy.
    expect(await importFreshModule(entry)).toBe(await importFreshModule(entry))
    await fsp.rm(sub, { recursive: true, force: true })
  })

  test('does not immediately retry a plugin runtime exception', async () => {
    const file = path.join(dir, 'runtime-failure.mjs')
    const counter = `__localixRuntimeImport${process.pid}`
    await fsp.writeFile(
      file,
      `globalThis.${counter} = (globalThis.${counter} ?? 0) + 1; throw new Error('runtime boom')`,
    )

    expect(importFreshModule(file)).rejects.toThrow('runtime boom')
    expect((globalThis as Record<string, unknown>)[counter]).toBe(1)
    delete (globalThis as Record<string, unknown>)[counter]
  })

  test('retries a rejected import when the repaired file keeps the same mtime URL', async () => {
    const file = path.join(dir, 'transient-module.mjs')
    await fsp.writeFile(file, 'export const value = }')
    const fixedTime = new Date('2026-07-29T00:00:00.000Z')
    await fsp.utimes(file, fixedTime, fixedTime)
    const failedUrl = freshModuleUrl(file)
    expect(importFreshModule(file)).rejects.toThrow()

    await fsp.writeFile(file, 'export const value = 42')
    await fsp.utimes(file, fixedTime, fixedTime)
    expect(freshModuleUrl(file)).toBe(failedUrl)

    const loaded = (await importFreshModule(file)) as { value: number }
    expect(loaded.value).toBe(42)
  })

  test('restores when the cached recovery bundle has been removed from $TMPDIR', async () => {
    // The recovered bundle is written to a SHARED $TMPDIR directory, which is not ours to rely
    // on: the OS purges temp files and this process deletes its own artifacts on exit. Caching
    // that URL without checking the file still exists turned a transient miss into a permanent
    // one — every later import of that path failed with "Cannot find module" while the real
    // module on disk was fine.
    const file = path.join(dir, 'purged-recovery.mjs')
    await fsp.writeFile(file, 'export const value = }')
    const fixedTime = new Date('2026-07-30T00:00:00.000Z')
    await fsp.utimes(file, fixedTime, fixedTime)
    expect(importFreshModule(file)).rejects.toThrow()

    const retryPrefix = `localix-module-retry-${process.pid}-`
    const retryDirsBefore = new Set(
      (await fsp.readdir(os.tmpdir())).filter((entry) => entry.startsWith(retryPrefix)),
    )
    await fsp.writeFile(file, 'export const value = 7')
    await fsp.utimes(file, fixedTime, fixedTime)
    expect(((await importFreshModule(file)) as { value: number }).value).toBe(7)

    // Now purge the recovery directory the way the OS would, leaving the cached URL dangling.
    const newRetryDirs = (await fsp.readdir(os.tmpdir())).filter(
      (entry) => entry.startsWith(retryPrefix) && !retryDirsBefore.has(entry),
    )
    expect(newRetryDirs).toHaveLength(1)
    await fsp.rm(path.join(os.tmpdir(), newRetryDirs[0]!), {
      recursive: true,
      force: true,
    })
    expect(((await importFreshModule(file)) as { value: number }).value).toBe(7)
  })
})
