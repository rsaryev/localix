import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  installerUrl,
  releaseInstallerUrl,
  STABLE_INSTALLER_NAMES,
  stableInstallerUrl,
} from './downloadOptions'

const repoRoot = join(import.meta.dir, '..', '..', '..', '..')

describe('installer links', () => {
  // A link built from a versioned installer name goes stale with the next release. The landing
  // links to a name that never changes, and the release workflow is what uploads that name: if the
  // two drift, the page offers a download that answers 404.
  test('the release workflow uploads every name the landing page links to', () => {
    const workflow = readFileSync(join(repoRoot, '.github/workflows/release.yml'), 'utf8')
    for (const name of Object.values(STABLE_INSTALLER_NAMES)) {
      expect(workflow).toContain(name)
    }
  })

  test('a link resolves to the newest release, never to a version', () => {
    for (const id of Object.keys(
      STABLE_INSTALLER_NAMES,
    ) as (keyof typeof STABLE_INSTALLER_NAMES)[]) {
      const url = stableInstallerUrl(id)
      expect(url).toContain('/releases/latest/download/')
      expect(url).not.toMatch(/\d+\.\d+\.\d+/u)
      expect(url.endsWith(STABLE_INSTALLER_NAMES[id])).toBe(true)
    }
  })

  test('before any release is published every installer stays coming soon', () => {
    for (const id of Object.keys(
      STABLE_INSTALLER_NAMES,
    ) as (keyof typeof STABLE_INSTALLER_NAMES)[]) {
      expect(installerUrl(id, { live: false })).toBeUndefined()
    }
  })

  // The deploy hands over the newest published tag, so a link names the release it was built for
  // and never depends on what `latest` resolves to at the moment of the click.
  test('a beta tag links into that release, not through latest', () => {
    const url = installerUrl('mac-arm64', { live: true, tag: 'v0.1.0-beta.1' })
    expect(url).toBe(releaseInstallerUrl('mac-arm64', 'v0.1.0-beta.1'))
    expect(url).toContain('/releases/download/v0.1.0-beta.1/')
    expect(url).not.toContain('/latest/')
    expect(url?.endsWith(STABLE_INSTALLER_NAMES['mac-arm64'])).toBe(true)
  })

  test('an installer the release did not ship is not linked', () => {
    const release = {
      live: true,
      tag: 'v0.1.0-beta.1',
      assets: ['latest.json'],
    }
    expect(installerUrl('mac-arm64', release)).toBeUndefined()
    expect(
      installerUrl('mac-arm64', { ...release, assets: [STABLE_INSTALLER_NAMES['mac-arm64']] }),
    ).toBeDefined()
  })

  test('without a tag it falls back to the stable latest link', () => {
    expect(installerUrl('mac-arm64', { live: true })).toBe(stableInstallerUrl('mac-arm64'))
  })
})
