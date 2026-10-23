import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { cachedKit, kitInputsDigest, storeKit } from './mini-app-kit-cache.mjs'

const dirs: string[] = []
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'kit-cache-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('kitInputsDigest', () => {
  // `tsc --watch` re-emits identical `dist` files on every launch; that must still be a hit.
  test('a rewrite with the same bytes keeps the key; a content change moves it', () => {
    const repo = scratch()
    mkdirSync(join(repo, 'pkg', 'dist'), { recursive: true })
    const file = join(repo, 'pkg', 'dist', 'index.js')
    writeFileSync(file, 'export const a = 1\n')
    const before = kitInputsDigest(repo, ['pkg/dist', 'missing/input'])

    writeFileSync(file, 'export const a = 1\n')
    utimesSync(file, new Date(), new Date(Date.now() + 60_000))
    expect(kitInputsDigest(repo, ['pkg/dist', 'missing/input'])).toBe(before)

    writeFileSync(file, 'export const a = 2\n')
    expect(kitInputsDigest(repo, ['pkg/dist', 'missing/input'])).not.toBe(before)
  })

  // The kit copies vendor packages out of node_modules: a dependency upgrade must not hit a kit
  // staged from the old ones, even though no listed input changed.
  test('a lockfile change moves the key', () => {
    const repo = scratch()
    writeFileSync(join(repo, 'bun.lock'), '{"react":"19.0.0"}')
    const before = kitInputsDigest(repo, [])
    writeFileSync(join(repo, 'bun.lock'), '{"react":"19.1.0"}')
    expect(kitInputsDigest(repo, [])).not.toBe(before)
  })
})

describe('cachedKit / storeKit', () => {
  test('only a stored kit with its manifest is a hit, and old kits are pruned', () => {
    const cache = scratch()
    const staged = scratch()
    writeFileSync(join(staged, 'kit.json'), '{}')

    expect(cachedKit(cache, 'a'.repeat(32), 'kit.json')).toBeNull()
    // A half-written entry (no manifest) is not a kit.
    mkdirSync(join(cache, 'b'.repeat(32)))
    expect(cachedKit(cache, 'b'.repeat(32), 'kit.json')).toBeNull()

    for (const digest of ['1', '2', '3', '4'].map((c) => c.repeat(32)))
      storeKit(cache, digest, staged)
    expect(cachedKit(cache, '4'.repeat(32), 'kit.json')).toBe(join(cache, '4'.repeat(32)))
    // The current kit plus the two newest others survive.
    expect(readdirSync(cache).filter((name) => /^[0-9a-f]{32}$/u.test(name)).length).toBe(3)
  })
})
