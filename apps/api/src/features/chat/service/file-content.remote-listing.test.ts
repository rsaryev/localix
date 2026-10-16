import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { ExecutionEnvironment } from '../../agent-core/tools/environment'
import { listRemoteDirectory } from './file-content'

/**
 * The far-side listing protocol, run for real through `bash -c` — the shell the ssh
 * and docker backends wrap every command in — against names the old `ls | awk` line
 * protocol mangled. On this host `find` is whichever one the OS ships (BSD on macOS,
 * GNU on Linux CI), so the suite exercises the portable subset on both.
 */
const bashEnv = {
  config: { kind: 'ssh' },
  exec: (command: string) =>
    new Promise((resolve) => {
      execFile(
        'bash',
        ['-c', command],
        { timeout: 10_000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 },
        (error, stdout, stderr) =>
          resolve({
            stdout,
            stderr,
            exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
          }),
      )
    }),
} as unknown as ExecutionEnvironment

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'remote-listing-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : 1)

describe('listRemoteDirectory (real shell)', () => {
  test('keeps names with edge whitespace, newlines, unicode and sentinel text intact', async () => {
    const files = [' lead.txt', 'trail.txt ', 'line\nbreak.txt', 'ünïcödé — 日本.md', '__NOT_DIR__']
    for (const name of files) writeFileSync(path.join(dir, name), 'x')
    mkdirSync(path.join(dir, ' spaced dir '))
    mkdirSync(path.join(dir, 'nested\ndir'))

    const result = await listRemoteDirectory(bashEnv, dir)

    expect(result).not.toBeNull()
    expect(result!.total).toBe(7)
    expect([...result!.entries].sort(byName)).toEqual(
      [
        ...files.map((name) => ({ name, type: 'file' as const })),
        { name: ' spaced dir ', type: 'dir' as const },
        { name: 'nested\ndir', type: 'dir' as const },
      ].sort(byName),
    )
  })

  test('lists a symlink to a folder as a file, like the local readdir branch', async () => {
    mkdirSync(path.join(dir, 'real'))
    symlinkSync(path.join(dir, 'real'), path.join(dir, 'link'))

    const result = await listRemoteDirectory(bashEnv, dir)

    expect([...result!.entries].sort(byName)).toEqual([
      { name: 'link', type: 'file' },
      { name: 'real', type: 'dir' },
    ])
  })

  test('caps at 1000 entries with directories first and the exact total', async () => {
    for (let i = 0; i < 3; i++) mkdirSync(path.join(dir, `d${i}`))
    for (let i = 0; i < 1002; i++) writeFileSync(path.join(dir, `f${i}`), '')

    const result = await listRemoteDirectory(bashEnv, dir)

    expect(result!.entries).toHaveLength(1000)
    expect(result!.total).toBe(1005)
    expect(result!.entries.slice(0, 3).every((entry) => entry.type === 'dir')).toBe(true)
  })

  test('an empty folder is an empty listing, a missing or file path is not a folder', async () => {
    expect(await listRemoteDirectory(bashEnv, dir)).toEqual({ entries: [], total: 0 })
    expect(await listRemoteDirectory(bashEnv, path.join(dir, 'missing'))).toBeNull()
    writeFileSync(path.join(dir, 'plain'), '')
    expect(await listRemoteDirectory(bashEnv, path.join(dir, 'plain'))).toBeNull()
  })

  test('a target path with a quote and spaces is one shell word', async () => {
    const target = path.join(dir, "it's a dir")
    mkdirSync(target)
    writeFileSync(path.join(target, 'a'), '')
    expect(await listRemoteDirectory(bashEnv, target)).toEqual({
      entries: [{ name: 'a', type: 'file' }],
      total: 1,
    })
  })
})

describe('listRemoteDirectory (protocol)', () => {
  const fixed = (stdout: string, exitCode = 0) =>
    ({ exec: async () => ({ stdout, stderr: '', exitCode }) }) as unknown as ExecutionEnvironment

  test('drops a record the byte cap cut short and pads a BSD wc count', async () => {
    const result = await listRemoteDirectory(fixed('      3\n./d\0\0./a\0./partial-na'), '/r')
    expect(result).toEqual({
      entries: [
        { name: 'd', type: 'dir' },
        { name: 'a', type: 'file' },
      ],
      total: 3,
    })
  })

  test('never reports fewer entries than it shows when the folder changed between reads', async () => {
    const result = await listRemoteDirectory(fixed('0\n./a\0\0./b\0'), '/r')
    expect(result?.total).toBe(2)
  })

  test('a failed command or a malformed stream is not a folder', async () => {
    expect(await listRemoteDirectory(fixed('', 3), '/r')).toBeNull()
    expect(await listRemoteDirectory(fixed('x\n'), '/r')).toBeNull()
    expect(await listRemoteDirectory(fixed('1\nno-prefix\0'), '/r')).toBeNull()
  })
})
