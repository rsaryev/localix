import { expect, spyOn, test } from 'bun:test'
import { mkdtemp, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readFile } from './file-content'
import type { FileOpsContext } from './file-ops-context'
import { localEnvironment } from '../../agent-core/tools/environments/local'

const context = (dir: string): FileOpsContext => ({
  requireSession: async () => ({ id: 'snapshot', executionBackend: 'local' }) as never,
  resolveSessionWorkingDir: async () => dir,
})

test('conditional reads revalidate an atomic replacement with the same size and restored mtime', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'snapshot-replace-'))
  const original = path.join(dir, 'a.txt')
  const replacement = path.join(dir, 'replacement.txt')
  const read = spyOn(localEnvironment, 'readFile')
  try {
    await writeFile(original, 'one')
    const identity = await stat(original)
    const first = await readFile(context(dir), 'u', 'snapshot', 'a.txt', { full: true })
    await writeFile(replacement, 'two')
    await utimes(replacement, identity.atime, identity.mtime)
    await rename(replacement, original)
    const second = await readFile(context(dir), 'u', 'snapshot', 'a.txt', {
      full: true,
      knownHash: first.hash,
    })
    expect(second.content).toBe('two')
    expect(second.hash).not.toBe(first.hash)
    expect(second.unchanged).toBeUndefined()
    expect(read).toHaveBeenCalledTimes(2)
  } finally {
    read.mockRestore()
    await rm(dir, { recursive: true, force: true })
  }
})

test('an aborted conditional read rejects even when its local snapshot is cached', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'snapshot-abort-'))
  const read = spyOn(localEnvironment, 'readFile')
  const exec = spyOn(localEnvironment, 'exec')
  try {
    await writeFile(path.join(dir, 'a.txt'), 'one')
    const first = await readFile(context(dir), 'u', 'snapshot', 'a.txt', { full: true })
    const controller = new AbortController()
    const reason = new Error('retired request')
    controller.abort(reason)
    await expect(
      readFile(context(dir), 'u', 'snapshot', 'a.txt', {
        full: true,
        knownHash: first.hash,
        signal: controller.signal,
      }),
    ).rejects.toBe(reason)
    expect(read).toHaveBeenCalledTimes(1)
    expect(exec).not.toHaveBeenCalled()
  } finally {
    read.mockRestore()
    exec.mockRestore()
    await rm(dir, { recursive: true, force: true })
  }
})
