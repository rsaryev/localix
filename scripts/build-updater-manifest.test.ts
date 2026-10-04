import { describe, expect, test } from 'bun:test'

import { createUpdaterManifest, parsePlatformList } from './build-updater-manifest.mjs'

const signatures = [
  { name: 'Localix_aarch64.app.tar.gz.sig', signature: 'mac-arm-signature\n' },
  { name: 'Localix_x86_64.app.tar.gz.sig', signature: 'mac-intel-signature\n' },
  { name: 'Localix 1.2.3_x64-setup.exe.sig', signature: 'windows-signature\n' },
  { name: 'Localix_1.2.3_amd64.AppImage.sig', signature: 'linux-signature\n' },
  { name: 'Localix_1.2.3_amd64.deb.sig', signature: 'deb-signature\n' },
]
const assets = signatures.flatMap(({ name }) => [name, name.slice(0, -'.sig'.length)])

describe('updater manifest', () => {
  test('a macOS-only release lists exactly its platforms and needs no other signatures', () => {
    const macOnly = signatures.slice(0, 2)
    const manifest = createUpdaterManifest({
      repository: 'rsaryev/localix',
      tag: 'v1.2.3',
      version: '1.2.3',
      publishedAt: '2026-07-24T01:02:03Z',
      assets: macOnly.flatMap(({ name }) => [name, name.slice(0, -'.sig'.length)]),
      signatures: macOnly,
      platforms: parsePlatformList('darwin-aarch64,darwin-x86_64'),
    })

    expect(Object.keys(manifest.platforms)).toEqual(['darwin-aarch64', 'darwin-x86_64'])
  })

  test('a platform named for the release still fails when its signature is missing', () => {
    expect(() =>
      createUpdaterManifest({
        repository: 'rsaryev/localix',
        tag: 'v1.2.3',
        version: '1.2.3',
        publishedAt: '2026-07-24T01:02:03Z',
        assets: [],
        signatures: [],
        platforms: ['darwin-aarch64'],
      }),
    ).toThrow('Missing signed updater artifact for darwin-aarch64')
  })

  test('rejects a platform the manifest does not know', () => {
    expect(() => parsePlatformList('darwin-aarch64,darwin-arm64')).toThrow(
      'Unknown updater platform: darwin-arm64',
    )
    expect(parsePlatformList('')).toHaveLength(5)
  })

  test('maps every signed Tauri updater bundle to an encoded release URL', () => {
    const manifest = createUpdaterManifest({
      repository: 'rsaryev/localix',
      tag: 'v1.2.3',
      version: '1.2.3',
      publishedAt: '2026-07-24T01:02:03Z',
      assets,
      signatures,
    })

    expect(manifest).toMatchObject({
      version: '1.2.3',
      notes: 'Localix 1.2.3',
      pub_date: '2026-07-24T01:02:03.000Z',
      platforms: {
        'darwin-aarch64': { signature: 'mac-arm-signature' },
        'darwin-x86_64': { signature: 'mac-intel-signature' },
        'windows-x86_64': { signature: 'windows-signature' },
        'linux-x86_64': { signature: 'linux-signature' },
        'linux-x86_64-deb': { signature: 'deb-signature' },
      },
    })
    expect(manifest.platforms['windows-x86_64'].url).toEndWith('/Localix%201.2.3_x64-setup.exe')
  })

  test('gives a .deb install its own package instead of the AppImage fallback', () => {
    // The updater resolves `linux-x86_64-deb` before `linux-x86_64` for a deb install and its
    // installer rejects a payload that is not a Debian package, so the AppImage URL under the
    // generic key would fail on every click.
    const manifest = createUpdaterManifest({
      repository: 'rsaryev/localix',
      tag: 'v1.2.3',
      version: '1.2.3',
      publishedAt: '2026-07-24T01:02:03Z',
      assets,
      signatures,
    })

    expect(manifest.platforms['linux-x86_64-deb'].url).toEndWith('/Localix_1.2.3_amd64.deb')
    expect(manifest.platforms['linux-x86_64'].url).toEndWith('/Localix_1.2.3_amd64.AppImage')
  })

  test('refuses a release without a signed .deb rather than stranding deb installs', () => {
    expect(() =>
      createUpdaterManifest({
        repository: 'rsaryev/localix',
        tag: 'v1.2.3',
        version: '1.2.3',
        publishedAt: '2026-07-24T01:02:03Z',
        assets,
        signatures: signatures.filter(({ name }) => !name.endsWith('.deb.sig')),
      }),
    ).toThrow('Missing signed updater artifact for linux-x86_64-deb')
  })

  test('rejects a signature whose updater bundle was not uploaded', () => {
    expect(() =>
      createUpdaterManifest({
        repository: 'rsaryev/localix',
        tag: 'v1.2.3',
        version: '1.2.3',
        publishedAt: '2026-07-24T01:02:03Z',
        assets: assets.filter((name) => !name.endsWith('.AppImage')),
        signatures,
      }),
    ).toThrow('Signed updater artifact is missing from the release')
  })

  test('rejects a partial platform set and a mismatched version', () => {
    expect(() =>
      createUpdaterManifest({
        repository: 'rsaryev/localix',
        tag: 'v1.2.3',
        version: '1.2.3',
        publishedAt: '2026-07-24T01:02:03Z',
        assets: assets.slice(0, 2),
        signatures: signatures.slice(0, 1),
      }),
    ).toThrow('Missing signed updater artifact for darwin-x86_64')

    expect(() =>
      createUpdaterManifest({
        repository: 'rsaryev/localix',
        tag: 'v1.2.3',
        version: '1.2.4',
        publishedAt: '2026-07-24T01:02:03Z',
        assets,
        signatures,
      }),
    ).toThrow('Updater version does not match the release tag')
  })
})
