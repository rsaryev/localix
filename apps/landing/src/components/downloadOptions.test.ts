import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { STABLE_INSTALLER_NAMES, stableInstallerUrl } from './downloadOptions'

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
})
