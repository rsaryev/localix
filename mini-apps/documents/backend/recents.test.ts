import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRecentsIndex } from './recents'

let dir: string | undefined
afterEach(async () => {
  if (dir) {
    await chmod(dir, 0o755).catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
  dir = undefined
})

const entry = (id: string) => ({ id, source: `${id}.pdf`, format: 'pdf', at: 1 })

describe('recents index', () => {
  test('one failed write does not stop every later write', async () => {
    // The parked chain used to stay rejected after a failure, so every later record skipped.
    dir = await mkdtemp(path.join(tmpdir(), 'doc-recents-'))
    const recents = createRecentsIndex({ dir })
    await chmod(dir, 0o500)
    await recents.record(entry('a'))
    await chmod(dir, 0o755)
    await recents.record(entry('b'))
    expect((await recents.list()).map((e) => e.id)).toEqual(['b'])
  })

  test('concurrent records all land, newest first', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'doc-recents-'))
    const recents = createRecentsIndex({ dir })
    await Promise.all(['a', 'b', 'c'].map((id) => recents.record(entry(id))))
    expect((await recents.list()).map((e) => e.id)).toEqual(['c', 'b', 'a'])
  })
})
