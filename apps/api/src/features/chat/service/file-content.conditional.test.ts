import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { readFile } from './file-content'
import type { FileOpsContext } from './file-ops'
import type { SessionRecord } from '../repository'
import { localEnvironment } from '../../agent-core/tools/environments/local'

/**
 * The open editor re-reads its file on every coarse FS-watch frame that touches the
 * file's directory and on every visibility resume. In the overwhelmingly common case
 * the content is unchanged and the whole body is shipped over the wire only to be
 * discarded. A conditional read (`knownHash`) must answer "unchanged" WITHOUT the body.
 */

let dir: string
const ctx = (): FileOpsContext => ({
  requireSession: async () => ({ id: 's1', executionBackend: 'local' }) as unknown as SessionRecord,
  resolveSessionWorkingDir: async () => dir,
})

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'filecond-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('readFile binary round-trip', () => {
  test('a binary larger than the stdout capture cap survives intact', async () => {
    // 4 MB of deterministic bytes → ~5.5 MB of base64, past `spawnToResult`'s
    // 2 MB CAPTURE_CAP. Without `uncapped` the capture keeps only the TAIL, so the
    // viewer receives base64 missing its leading bytes: an undecodable image/PDF
    // and a `bytes` count derived from the truncated string. The agent's own
    // attach-file path already passes `uncapped` for exactly this reason.
    const bytes = Buffer.alloc(4_000_000)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251
    writeFileSync(path.join(dir, 'big.png'), bytes)

    const res = await readFile(ctx(), 'u', 's1', 'big.png', { full: true })
    expect(res.encoding).toBe('base64')
    expect(res.truncated).toBe(false)
    expect(res.bytes).toBe(bytes.length)
    const decoded = Buffer.from(res.content, 'base64')
    expect(decoded.byteLength).toBe(bytes.length)
    expect(decoded.equals(bytes)).toBe(true)
  })

  test('a small binary still round-trips and reports its exact byte count', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02])
    writeFileSync(path.join(dir, 'tiny.png'), bytes)

    const res = await readFile(ctx(), 'u', 's1', 'tiny.png')
    // 7 bytes pads to 12 base64 chars; the old length-derived estimate said 9.
    expect(res.bytes).toBe(7)
    expect(Buffer.from(res.content, 'base64').equals(bytes)).toBe(true)
  })

  test('an oversize binary is refused with its real size and no body', async () => {
    // Images cap at 10 MB. The refusal must not have read the file into memory.
    writeFileSync(path.join(dir, 'huge.png'), Buffer.alloc(10_000_001))
    const res = await readFile(ctx(), 'u', 's1', 'huge.png')
    expect(res.truncated).toBe(true)
    expect(res.content).toBe('')
    expect(res.bytes).toBe(10_000_001)
    expect(res.mimeType).toBe('image/png')
  })
})

describe('readFile conditional (knownHash)', () => {
  test('a matching knownHash answers unchanged without shipping the body', async () => {
    const big = 'x'.repeat(200_000)
    writeFileSync(path.join(dir, 'big.txt'), big)
    const diskRead = spyOn(localEnvironment, 'readFile')
    // Read a minute after the write: a file changed within the clock's tick is always re-read.
    const settled = { ...ctx(), now: () => Date.now() + 60_000 }

    try {
      const first = await readFile(settled, 'u', 's1', 'big.txt', { full: true })
      expect(first.content).toBe(big)
      expect(first.hash).toBeString()

      const second = await readFile(settled, 'u', 's1', 'big.txt', {
        full: true,
        knownHash: first.hash,
      })
      expect(second.unchanged).toBe(true)
      expect(second.content).toBe('')
      // The hash still rides along so the client's concurrency token stays valid.
      expect(second.hash).toBe(first.hash)
      expect(second.bytes).toBe(first.bytes)
      // The local metadata fingerprint proves the cached hash still names this
      // inode revision, so the conditional request never re-reads the body.
      expect(diskRead).toHaveBeenCalledTimes(1)
    } finally {
      diskRead.mockRestore()
    }
  })

  test('a stale knownHash returns the full new content', async () => {
    writeFileSync(path.join(dir, 'a.txt'), 'one')
    const diskRead = spyOn(localEnvironment, 'readFile')

    try {
      const first = await readFile(ctx(), 'u', 's1', 'a.txt', { full: true })
      writeFileSync(path.join(dir, 'a.txt'), 'two')

      const second = await readFile(ctx(), 'u', 's1', 'a.txt', {
        full: true,
        knownHash: first.hash,
      })
      expect(second.unchanged).toBeUndefined()
      expect(second.content).toBe('two')
      expect(second.hash).not.toBe(first.hash)
      // Same byte length is not enough: ctime/mtime changed, so this must take
      // the full read + hash fallback instead of trusting stale metadata.
      expect(diskRead).toHaveBeenCalledTimes(2)
    } finally {
      diskRead.mockRestore()
    }
  })

  test('no knownHash is unchanged behaviour — the body always ships', async () => {
    writeFileSync(path.join(dir, 'a.txt'), 'one')
    const res = await readFile(ctx(), 'u', 's1', 'a.txt', { full: true })
    expect(res.unchanged).toBeUndefined()
    expect(res.content).toBe('one')
  })

  test('a truncated read never claims unchanged (no hash to compare)', async () => {
    // Bigger than the 64 KB view cap; read WITHOUT `full`, so it truncates.
    writeFileSync(path.join(dir, 'huge.txt'), 'y'.repeat(100_000))
    const res = await readFile(ctx(), 'u', 's1', 'huge.txt', { knownHash: 'whatever' })
    expect(res.truncated).toBe(true)
    expect(res.unchanged).toBeUndefined()
    expect(res.content.length).toBeGreaterThan(0)
  })

  test('an empty local file does not spawn a directory probe', async () => {
    writeFileSync(path.join(dir, 'empty.txt'), '')
    const exec = spyOn(localEnvironment, 'exec')

    try {
      const res = await readFile(ctx(), 'u', 's1', 'empty.txt', { full: true })
      expect(res.content).toBe('')
      expect(res.bytes).toBe(0)
      expect(res.hash).toBeString()
      expect(exec).not.toHaveBeenCalled()
    } finally {
      exec.mockRestore()
    }
  })
})

describe('readFile cancellation', () => {
  test('passes the request signal to text reads and never probes a directory after abort', async () => {
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    const read = spyOn(localEnvironment, 'readFile').mockImplementation(async (_path, signal) => {
      receivedSignal = signal
      controller.abort()
      signal?.throwIfAborted()
      return ''
    })
    const exec = spyOn(localEnvironment, 'exec')

    try {
      expect(
        readFile(ctx(), 'u', 's1', 'retired.ts', {
          full: true,
          signal: controller.signal,
        }),
      ).rejects.toThrow()
      expect(receivedSignal).toBe(controller.signal)
      expect(exec).not.toHaveBeenCalled()
    } finally {
      read.mockRestore()
      exec.mockRestore()
    }
  })

  test('passes the request signal to binary reads', async () => {
    const controller = new AbortController()
    const exec = spyOn(localEnvironment, 'exec').mockResolvedValue({
      stdout: 'OK 1\nAA==\n',
      stderr: '',
      exitCode: 0,
    })

    try {
      await readFile(ctx(), 'u', 's1', 'one.png', { signal: controller.signal })
      expect(exec).toHaveBeenCalledWith(expect.any(String), {
        uncapped: true,
        signal: controller.signal,
      })
    } finally {
      exec.mockRestore()
    }
  })
})
