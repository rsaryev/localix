import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { watchPathNative } from './path-watch'

const releases: (() => void)[] = []
const dirs: string[] = []

afterEach(async () => {
  while (releases.length) releases.pop()?.()
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true }).catch(() => {})
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'pathwatch-'))
  dirs.push(dir)
  return dir
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Watch, act, and collect every reported name once the backend has been quiet a while. */
async function namesAfter(
  target: string,
  recursive: boolean,
  act: () => Promise<void>,
): Promise<{ names: Set<string | null>; errored: boolean }> {
  const names = new Set<string | null>()
  let errored = false
  releases.push(
    watchPathNative(
      target,
      recursive,
      (name) => names.add(name),
      () => (errored = true),
    ),
  )
  await sleep(150) // the native subscription arms asynchronously
  await act()
  await sleep(400)
  return { names, errored }
}

describe('watchPathNative (real fs)', () => {
  // The defect it replaces for plugins: Bun's recursive fs.watch on macOS reported part of a burst.
  test('a recursive directory watch reports every entry of a burst, relative to the root', async () => {
    const root = await tempDir()
    const { names } = await namesAfter(root, true, async () => {
      await writeFile(path.join(root, 'a.jsonl'), '1')
      await writeFile(path.join(root, 'b.jsonl'), '1')
      await mkdir(path.join(root, 'project'))
      await writeFile(path.join(root, 'project', 'session.jsonl'), '1')
    })
    for (const name of ['a.jsonl', 'b.jsonl', 'project', 'project/session.jsonl']) {
      expect(names).toContain(name)
    }
  })

  test('a non-recursive watch reports direct entries only', async () => {
    const root = await tempDir()
    await mkdir(path.join(root, 'nested'))
    const { names } = await namesAfter(root, false, async () => {
      await writeFile(path.join(root, 'top.txt'), '1')
      await writeFile(path.join(root, 'nested', 'deep.txt'), '1')
    })
    expect(names).toContain('top.txt')
    expect(names).not.toContain('nested/deep.txt')
  })

  // A log a `wait` tails: its siblings changing must not wake the waiter.
  test('a file watch reports only that file, by its own name', async () => {
    const root = await tempDir()
    const log = path.join(root, 'turns.jsonl')
    await writeFile(log, '1')
    const { names } = await namesAfter(log, false, async () => {
      await writeFile(path.join(root, 'other.jsonl'), '1')
      await writeFile(log, '1\n2')
    })
    expect([...names]).toEqual(['turns.jsonl'])
  })

  test('a path that cannot be watched reports onError', async () => {
    const { errored } = await namesAfter(
      path.join(await tempDir(), 'missing'),
      true,
      async () => {},
    )
    expect(errored).toBe(true)
  })
})
