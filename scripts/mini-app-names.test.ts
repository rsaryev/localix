import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { hasExtensionManifest, readExtensionManifest } from './lib/extension-manifest.mjs'

/**
 * Every shipped mini app names itself, in one house style.
 *
 * The list in Settings had bare kebab ids like `database` sitting between `DevOps Workspace` and
 * `Reader`, which looked like a casing bug but was not: `displayName` is optional, and
 * eleven call sites fell back to the kebab id. Two rules keep that from coming back — and they are
 * checked against the real manifests, because a style written only in a comment is a style that
 * drifts.
 *
 *   1. Every mini app declares a `displayName` that starts with a capital.
 *   2. No mini app is named after the generic container it opens in. "Workspace" was on four of
 *      them and distinguished none; the rail launchers had already dropped it, so the two
 *      surfaces disagreed about what the same mini app is called.
 *
 * A unique word that IS the product's own name — "Studio", "Client", "Space" — is a name, not a
 * container, and stays.
 */

const repoRoot = resolve(import.meta.dir, '..')
const miniAppsDir = join(repoRoot, 'mini-apps')

/** Words that describe the frame rather than the mini app. */
const CONTAINER_WORDS = ['Workspace', 'Panel', 'View', 'Mini app Panel']

interface Manifest {
  path: string
  name: string
  displayName?: string
}

function manifests(): Manifest[] {
  return readdirSync(miniAppsDir)
    .flatMap((entry) => {
      const dir = join(miniAppsDir, entry)
      if (!statSync(dir).isDirectory() || !hasExtensionManifest(dir)) return []
      const parsed = readExtensionManifest(dir) as Manifest
      return [{ ...parsed, path: `mini-apps/${entry}` }]
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

describe('shipped mini app names', () => {
  const all = manifests()

  test('there are mini apps to check at all', () => {
    // Guards the guard: a broken scan would make every assertion below vacuously true.
    expect(all.length).toBeGreaterThan(10)
  })

  test('every mini app declares a display name', () => {
    const missing = all
      .filter((miniApp) => !miniApp.displayName?.trim())
      .map((miniApp) => miniApp.path)
    expect(missing).toEqual([])
  })

  test('every display name starts with a capital', () => {
    const lowercase = all
      .filter((miniApp) => {
        const first = miniApp.displayName?.trim().charAt(0) ?? ''
        return first !== '' && first !== first.toUpperCase()
      })
      .map((miniApp) => `${miniApp.path}: ${miniApp.displayName}`)
    expect(lowercase).toEqual([])
  })

  test('no display name is padded with the container it opens in', () => {
    const padded = all
      .filter((miniApp) =>
        CONTAINER_WORDS.some((word) => miniApp.displayName?.trim().endsWith(word) === true),
      )
      .map((miniApp) => `${miniApp.path}: ${miniApp.displayName}`)
    expect(padded).toEqual([])
  })

  test('a rail launcher never contradicts the name Settings shows', () => {
    // The two surfaces are registered in different files, which is exactly how they came to
    // disagree ("Reader" in the rail, "Reader Workspace" in Settings). The launcher title may be
    // more specific than the manifest name, but it may not carry a container word.
    const offenders: string[] = []
    for (const miniApp of all) {
      const registerPath = join(miniAppsDir, miniApp.name, 'ui', 'register.tsx')
      let source: string
      try {
        source = readFileSync(registerPath, 'utf8')
      } catch {
        continue
      }
      for (const match of source.matchAll(/\b(?:title|label):\s*'([^']+)'/gu)) {
        const value = match[1]!
        if (CONTAINER_WORDS.some((word) => value === word || value.endsWith(` ${word}`))) {
          offenders.push(`mini-apps/${miniApp.name}/ui/register.tsx: ${value}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
