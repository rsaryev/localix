import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  assertEndpoints,
  assertOverlaySafe,
  assertPubkey,
  assertUpdaterEmbedded,
  readUpdaterSettings,
  renderReleaseConfig,
  writeReleaseConfig,
} from './build-release-config.mjs'

const desktop = resolve(import.meta.dir, '..')
const base = JSON.parse(readFileSync(join(desktop, 'src-tauri', 'tauri.conf.json'), 'utf8'))
const scratch = mkdtempSync(join(tmpdir(), 'release-config-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

/** A minisign public key as the Tauri signer writes it (base64 of the two-line .pub file). */
const key = (id: string) =>
  Buffer.from(
    `untrusted comment: minisign public key: ${id}\nRWQvgIkvvoxAwSdF1sjI73bi7AWccKpRKxhHiP5uxNZGOibSi28oFiMq\n`,
  ).toString('base64')

/** RFC 7396 JSON merge patch, which is how Tauri applies a `--config` overlay. */
function merge(target: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch
  const out: Record<string, unknown> =
    target && typeof target === 'object' && !Array.isArray(target)
      ? { ...(target as Record<string, unknown>) }
      : {}
  for (const [name, value] of Object.entries(patch)) {
    if (value === null) delete out[name]
    else out[name] = merge(out[name], value)
  }
  return out
}

describe('the base config', () => {
  test('carries no updater, so a build from a checkout can never read the release feed', () => {
    expect(base.plugins.updater).toBeUndefined()
    expect(base.bundle.createUpdaterArtifacts).toBe(false)
    expect(JSON.stringify(base)).not.toMatch(/latest\.json|minisign/u)
  })
})

describe('the committed release settings', () => {
  test('are a valid minisign key and https endpoints', () => {
    const settings = readUpdaterSettings({ env: {} })
    expect(() => assertPubkey(settings.pubkey)).not.toThrow()
    expect(() => assertEndpoints(settings.endpoints)).not.toThrow()
    expect(settings.endpoints[0]).toMatch(/\/releases\/latest\/download\/latest\.json$/u)
  })
})

describe('the overlay', () => {
  const settings = readUpdaterSettings({ env: {} })

  test('turns on updater artifacts and sets the key and endpoints, nothing else', () => {
    const overlay = assertOverlaySafe(renderReleaseConfig(settings))
    expect(overlay.bundle).toEqual({ createUpdaterArtifacts: true })
    expect(Object.keys(overlay.plugins)).toEqual(['updater'])
    expect(overlay.plugins.updater).toEqual(settings)
  })

  test('applied to the base config it leaves the sidecar, resources and identity untouched', () => {
    const merged = merge(base, renderReleaseConfig(settings)) as typeof base
    expect(merged.bundle.externalBin).toEqual(base.bundle.externalBin)
    expect(merged.bundle.resources).toEqual(base.bundle.resources)
    expect(merged.bundle.targets).toEqual(base.bundle.targets)
    expect(merged.identifier).toBe(base.identifier)
    expect(merged.plugins['deep-link']).toEqual(base.plugins['deep-link'])
    expect(merged.bundle.createUpdaterArtifacts).toBe(true)
    expect(merged.plugins.updater.endpoints).toEqual(settings.endpoints)
  })

  test('refuses to set anything that a merge would clobber', () => {
    for (const stray of [
      { bundle: { externalBin: ['binaries/bun'] } },
      { bundle: { resources: ['resources/**/*'] } },
      { bundle: { targets: ['app'] } },
      { identifier: 'ai.example' },
      { app: { windows: [] } },
    ]) {
      const overlay = {
        ...renderReleaseConfig(settings),
        ...stray,
        bundle: { createUpdaterArtifacts: true, ...stray.bundle },
      }
      expect(() => assertOverlaySafe(overlay)).toThrow('may not set')
    }
  })
})

describe('environment overrides', () => {
  const file = join(scratch, 'settings.json')
  writeFileSync(
    file,
    JSON.stringify({ pubkey: key('AAAAAAAAAAAAAAAA'), endpoints: ['https://example.com/a.json'] }),
  )

  test('replace the committed key and endpoints, separately', () => {
    const override = key('BBBBBBBBBBBBBBBB')
    expect(readUpdaterSettings({ file, env: { LOCALIX_UPDATER_PUBKEY: override } })).toEqual({
      pubkey: override,
      endpoints: ['https://example.com/a.json'],
    })
    expect(
      readUpdaterSettings({
        file,
        env: { LOCALIX_UPDATER_ENDPOINTS: 'https://x.test/1.json, https://y.test/2.json' },
      }).endpoints,
    ).toEqual(['https://x.test/1.json', 'https://y.test/2.json'])
  })

  test('are ignored when empty', () => {
    expect(
      readUpdaterSettings({
        file,
        env: { LOCALIX_UPDATER_PUBKEY: '  ', LOCALIX_UPDATER_ENDPOINTS: ' , ' },
      }).endpoints,
    ).toEqual(['https://example.com/a.json'])
  })
})

describe('validation', () => {
  test('rejects a key that is not a base64 minisign public key', () => {
    for (const bad of ['', '   ', 'not base64 at all', Buffer.from('hello').toString('base64')]) {
      expect(() => assertPubkey(bad)).toThrow()
    }
    expect(() =>
      assertPubkey(
        Buffer.from('untrusted comment: minisign public key: X\nshort').toString('base64'),
      ),
    ).toThrow()
  })

  test('rejects http, non-URLs and an empty list', () => {
    expect(() => assertEndpoints(['http://example.com/latest.json'])).toThrow('must be https')
    expect(() => assertEndpoints(['not a url'])).toThrow('not a URL')
    expect(() => assertEndpoints([])).toThrow('no endpoints')
    expect(() => assertEndpoints(undefined)).toThrow('no endpoints')
  })
})

describe('writeReleaseConfig', () => {
  test('writes the overlay as JSON to the path it is given', () => {
    const out = join(scratch, 'overlay.json')
    expect(writeReleaseConfig({ out, env: {} })).toBe(out)
    const written = JSON.parse(readFileSync(out, 'utf8'))
    expect(written.bundle.createUpdaterArtifacts).toBe(true)
    expect(written.plugins.updater.endpoints[0]).toContain('latest.json')
  })

  test('writes nothing when a value is invalid', () => {
    const out = join(scratch, 'never.json')
    expect(() =>
      writeReleaseConfig({ out, env: { LOCALIX_UPDATER_ENDPOINTS: 'http://insecure.test/x' } }),
    ).toThrow()
    expect(() => readFileSync(out)).toThrow()
  })
})

describe('assertUpdaterEmbedded', () => {
  const pubkey = readUpdaterSettings({ env: {} }).pubkey

  test('passes for a binary that carries the key and fails for one that does not', () => {
    const withKey = join(scratch, 'with-key')
    const without = join(scratch, 'without-key')
    writeFileSync(
      withKey,
      Buffer.concat([Buffer.alloc(1024), Buffer.from(`{"pubkey":"${pubkey}"}`)]),
    )
    writeFileSync(without, Buffer.alloc(4096))
    expect(() => assertUpdaterEmbedded(withKey, pubkey)).not.toThrow()
    expect(() => assertUpdaterEmbedded(without, pubkey)).toThrow('would never update')
  })
})
