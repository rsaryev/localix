import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
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

import { createLocalTreeFs } from './fs-mutations'

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

describe('local tree port: an entry is the entry, not what a link points at', () => {
  test('a link to a folder is a file entry; the folder is a dir', async () => {
    const tree = createLocalTreeFs()
    expect(await tree.kind(path.join(dir, 'link'))).toBe('file')
    expect(await tree.kind(path.join(dir, 'real'))).toBe('dir')
    expect(await tree.kind(path.join(dir, 'missing'))).toBeNull()
  })

  test('a dangling link exists and has a kind, so it can be renamed or deleted', async () => {
    const tree = createLocalTreeFs()
    expect(await tree.exists(path.join(dir, 'dangling'))).toBe(true)
    expect(await tree.kind(path.join(dir, 'dangling'))).toBe('file')
    await tree.move(path.join(dir, 'dangling'), path.join(dir, 'renamed'))
    expect(lstatSync(path.join(dir, 'renamed')).isSymbolicLink()).toBe(true)
  })

  test('a paste target may be a link to a folder', async () => {
    expect(await createLocalTreeFs().isDir(path.join(dir, 'link'))).toBe(true)
  })

  test('removing a link to a folder leaves the folder and its contents', async () => {
    await createLocalTreeFs().remove(path.join(dir, 'link'))
    expect(existsSync(path.join(dir, 'link'))).toBe(false)
    expect(readFileSync(path.join(dir, 'real', 'inside.txt'), 'utf8')).toBe('kept')
  })

  test('a copied tree keeps a relative link verbatim', async () => {
    symlinkSync('inside.txt', path.join(dir, 'real', 'rel'))
    await createLocalTreeFs().copy(path.join(dir, 'real'), path.join(dir, 'copy'))
    expect(readlinkSync(path.join(dir, 'copy', 'rel'))).toBe('inside.txt')
    expect(readFileSync(path.join(dir, 'copy', 'inside.txt'), 'utf8')).toBe('kept')
  })

  test('createFile makes missing parents', async () => {
    const target = path.join(dir, 'a', 'b', 'new.txt')
    await createLocalTreeFs().createFile(target)
    expect(readFileSync(target, 'utf8')).toBe('')
  })
})

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
})
