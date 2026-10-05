import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertRunsAs, baselineAsset, fetchBaselineBun, parseShasums } from './sidecar-bun.mjs'

const scratch = mkdtempSync(join(tmpdir(), 'sidecar-bun-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const sha = (bytes: Uint8Array) => new Bun.CryptoHasher('sha256').update(bytes).digest('hex')

describe('baselineAsset', () => {
  test('names the baseline build for every x64 platform that has one', () => {
    expect(baselineAsset({ platform: 'linux', arch: 'x64' })).toBe('bun-linux-x64-baseline')
    expect(baselineAsset({ platform: 'win32', arch: 'x64' })).toBe('bun-windows-x64-baseline')
    expect(baselineAsset({ platform: 'darwin', arch: 'x64' })).toBe('bun-darwin-x64-baseline')
  })

  test('has none where there is no AVX2 requirement to avoid', () => {
    expect(baselineAsset({ platform: 'darwin', arch: 'arm64' })).toBeUndefined()
    expect(baselineAsset({ platform: 'linux', arch: 'arm64' })).toBeUndefined()
    expect(baselineAsset({ platform: 'freebsd', arch: 'x64' })).toBeUndefined()
  })
})

describe('parseShasums', () => {
  test('reads hash and file name per line and ignores anything else', () => {
    const a = 'a'.repeat(64)
    const b = 'b'.repeat(64)
    expect(
      parseShasums(`${a}  bun-linux-x64.zip\n${b} *bun-windows-x64.zip\nnot a line\n\n`),
    ).toEqual({
      'bun-linux-x64.zip': a,
      'bun-windows-x64.zip': b,
    })
  })
})

describe('fetchBaselineBun', () => {
  const zip = new TextEncoder().encode('pretend this is a zip archive')
  const asset = 'bun-linux-x64-baseline'

  /** A fake release: SHASUMS256.txt plus the zip, served by name; records what was asked for. */
  function release({ zipSha = sha(zip), listed = true, status = 200 } = {}) {
    const asked: string[] = []
    const fetchImpl = async (url: string) => {
      asked.push(url)
      const name = url.split('/').pop() ?? ''
      if (status !== 200) return new Response('nope', { status })
      if (name === 'SHASUMS256.txt') {
        return new Response(listed ? `${zipSha}  ${asset}.zip\n` : `${'0'.repeat(64)}  other.zip\n`)
      }
      return new Response(zip)
    }
    return { asked, fetchImpl: fetchImpl as unknown as typeof fetch }
  }

  /** Stands in for `unzip`: lays the executable out where the real archive would. */
  const extract = (_zip: string, into: string) => {
    mkdirSync(join(into, asset), { recursive: true })
    writeFileSync(join(into, asset, 'bun'), '#!/bin/sh\n')
  }
  const options = (dest: string, extra = {}) => ({
    version: '1.3.14',
    dest,
    platform: 'linux' as const,
    arch: 'x64' as const,
    extract,
    ...extra,
  })

  test('downloads from the pinned release, verifies the checksum and returns the executable', async () => {
    const dest = join(scratch, 'ok')
    const { asked, fetchImpl } = release()
    const exe = await fetchBaselineBun(options(dest, { fetchImpl }))
    expect(exe).toBe(join(dest, asset, 'bun'))
    expect(existsSync(exe!)).toBe(true)
    expect(asked).toEqual([
      'https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/SHASUMS256.txt',
      `https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/${asset}.zip`,
    ])
  })

  test('refuses an archive whose checksum differs from the published one, leaving nothing', async () => {
    const dest = join(scratch, 'tampered')
    const { fetchImpl } = release({ zipSha: 'f'.repeat(64) })
    await expect(fetchBaselineBun(options(dest, { fetchImpl }))).rejects.toThrow(
      'does not match its published checksum',
    )
    expect(existsSync(dest)).toBe(false)
  })

  test('refuses a release that does not list the asset, and a failing download', async () => {
    await expect(
      fetchBaselineBun(
        options(join(scratch, 'unlisted'), { fetchImpl: release({ listed: false }).fetchImpl }),
      ),
    ).rejects.toThrow(`lists no ${asset}.zip`)
    await expect(
      fetchBaselineBun(
        options(join(scratch, 'down'), { fetchImpl: release({ status: 404 }).fetchImpl }),
      ),
    ).rejects.toThrow('answered 404')
  })

  test('does nothing, and asks for nothing, on a platform without a baseline build', async () => {
    const { asked, fetchImpl } = release()
    const result = await fetchBaselineBun(
      options(join(scratch, 'arm'), { arch: 'arm64', fetchImpl }),
    )
    expect(result).toBeUndefined()
    expect(asked).toEqual([])
  })
})

describe('assertRunsAs', () => {
  test('accepts a Bun that reports the expected version', () => {
    expect(() => assertRunsAs(process.execPath, Bun.version)).not.toThrow()
  })

  test('rejects the wrong version and a file that cannot run', () => {
    expect(() => assertRunsAs(process.execPath, '0.0.1')).toThrow('expected 0.0.1')
    const notBinary = join(scratch, 'not-a-binary')
    writeFileSync(notBinary, 'text')
    expect(() => assertRunsAs(notBinary, Bun.version)).toThrow()
  })
})
