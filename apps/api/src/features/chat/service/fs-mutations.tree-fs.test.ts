import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { ExecutionEnvironment } from '../../agent-core/tools/environment'
import { createLocalTreeFs, createShellTreeFs, treeFsFor, type TreeFs } from './fs-mutations'

/** The far-side port run through `bash -c`, the wrapper the ssh/docker backends use. */
const bashEnv: Pick<ExecutionEnvironment, 'exec'> = {
  exec: (command) =>
    new Promise((resolve) => {
      execFile(
        'bash',
        ['-c', command],
        { timeout: 10_000, killSignal: 'SIGKILL' },
        (error, stdout, stderr) =>
          resolve({ stdout, stderr, exitCode: error ? Number(error.code) || 1 : 0 }),
      )
    }),
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'tree-fs-'))
  mkdirSync(path.join(dir, 'real'))
  writeFileSync(path.join(dir, 'real', 'inside.txt'), 'kept')
  symlinkSync(path.join(dir, 'real'), path.join(dir, 'link'))
  symlinkSync(path.join(dir, 'nowhere'), path.join(dir, 'dangling'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const ports: Array<[string, () => TreeFs]> = [
  ['local', () => createLocalTreeFs()],
  ['shell', () => createShellTreeFs(bashEnv)],
]

describe.each(ports)(
  '%s tree port: an entry is the entry, not what a link points at',
  (_, make) => {
    test('a link to a folder is a file entry; the folder is a dir', async () => {
      const tree = make()
      expect(await tree.kind(path.join(dir, 'link'))).toBe('file')
      expect(await tree.kind(path.join(dir, 'real'))).toBe('dir')
      expect(await tree.kind(path.join(dir, 'missing'))).toBeNull()
    })

    test('a dangling link exists and has a kind, so it can be renamed or deleted', async () => {
      const tree = make()
      expect(await tree.exists(path.join(dir, 'dangling'))).toBe(true)
      expect(await tree.kind(path.join(dir, 'dangling'))).toBe('file')
      await tree.move(path.join(dir, 'dangling'), path.join(dir, 'renamed'))
      expect(lstatSync(path.join(dir, 'renamed')).isSymbolicLink()).toBe(true)
    })

    test('a paste target may be a link to a folder', async () => {
      expect(await make().isDir(path.join(dir, 'link'))).toBe(true)
    })

    test('removing a link to a folder leaves the folder and its contents', async () => {
      await make().remove(path.join(dir, 'link'))
      expect(existsSync(path.join(dir, 'link'))).toBe(false)
      expect(readFileSync(path.join(dir, 'real', 'inside.txt'), 'utf8')).toBe('kept')
    })

    test('a copied tree keeps a relative link verbatim', async () => {
      symlinkSync('inside.txt', path.join(dir, 'real', 'rel'))
      await make().copy(path.join(dir, 'real'), path.join(dir, 'copy'))
      expect(readlinkSync(path.join(dir, 'copy', 'rel'))).toBe('inside.txt')
      expect(readFileSync(path.join(dir, 'copy', 'inside.txt'), 'utf8')).toBe('kept')
    })

    test('createFile makes missing parents', async () => {
      const target = path.join(dir, 'a', 'b', 'new.txt')
      await make().createFile(target)
      expect(readFileSync(target, 'utf8')).toBe('')
    })
  },
)

describe('local tree port', () => {
  test('createFile refuses a file that appeared after the absence check', async () => {
    const target = path.join(dir, 'raced.txt')
    writeFileSync(target, 'theirs')
    expect(createLocalTreeFs().createFile(target)).rejects.toThrow()
    expect(readFileSync(target, 'utf8')).toBe('theirs')
  })

  const crossDevice = (): typeof fs => {
    const io = Object.create(fs) as typeof fs
    io.rename = async () => {
      throw Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' })
    }
    return io
  }

  test('a move across filesystems falls back to copy then delete', async () => {
    const tree = createLocalTreeFs(crossDevice())
    symlinkSync('inside.txt', path.join(dir, 'real', 'rel'))
    await tree.move(path.join(dir, 'real'), path.join(dir, 'moved'))
    expect(existsSync(path.join(dir, 'real'))).toBe(false)
    expect(readFileSync(path.join(dir, 'moved', 'inside.txt'), 'utf8')).toBe('kept')
    expect(readlinkSync(path.join(dir, 'moved', 'rel'))).toBe('inside.txt')
  })

  test('a failed cross-device copy keeps the source and clears the partial copy', async () => {
    const io = crossDevice()
    io.cp = async (_from, to) => {
      mkdirSync(String(to))
      writeFileSync(path.join(String(to), 'half'), '')
      throw Object.assign(new Error('ENOSPC: no space left'), { code: 'ENOSPC' })
    }
    const tree = createLocalTreeFs(io)
    await expect(tree.move(path.join(dir, 'real'), path.join(dir, 'moved'))).rejects.toThrow(
      'ENOSPC',
    )
    expect(existsSync(path.join(dir, 'moved'))).toBe(false)
    expect(readFileSync(path.join(dir, 'real', 'inside.txt'), 'utf8')).toBe('kept')
  })

  test('any other rename failure is not retried as a copy', async () => {
    const io = Object.create(fs) as typeof fs
    io.rename = async () => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
    }
    let copied = false
    io.cp = async () => {
      copied = true
    }
    await expect(createLocalTreeFs(io).move('/a', '/b')).rejects.toThrow('EACCES')
    expect(copied).toBe(false)
  })

  test('a local session never spawns a shell for a tree mutation', async () => {
    const env = {
      config: { kind: 'local' },
      exec: async () => {
        throw new Error('spawned a shell')
      },
    } as unknown as ExecutionEnvironment
    const tree = treeFsFor(env)
    await tree.mkdirp(path.join(dir, 'x'))
    await tree.createFile(path.join(dir, 'x', 'f'))
    expect(await tree.kind(path.join(dir, 'x'))).toBe('dir')
    await tree.copy(path.join(dir, 'x'), path.join(dir, 'y'))
    await tree.move(path.join(dir, 'y'), path.join(dir, 'z'))
    await tree.remove(path.join(dir, 'z'))
    expect(await tree.exists(path.join(dir, 'z'))).toBe(false)
  })
})
