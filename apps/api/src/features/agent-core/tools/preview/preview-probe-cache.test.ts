/**
 * Regression: the visual-feedback probe is bundled once and MEMOIZED
 * in a module-level cache. `bun --watch src/index.ts` (the apps/api dev script) only
 * rebuilds the STATIC import graph of `src/index.ts`; the probe is built dynamically,
 * so a code change under `packages/visual-feedback/src/**` never rebuilds it and a
 * running dev server keeps serving a STALE probe until a manual restart — a landed
 * preview fix looks un-landed.
 *
 * `getPreviewProbeJs` now guards the cache on a source content fingerprint: rebuild when
 * the source version changes, but HOLD forever when `sourceVersion()` is null
 * (production/dist, where the probe source never changes). Both seams are injectable so
 * these assertions never touch the real bundler or the filesystem.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { getPreviewProbeJs, invalidatePreviewProbe, type ProbeCacheDeps } from './preview-probe'

/** A build that returns a fresh, identity-distinct string each time it runs. */
function countingBuild(): {
  deps: (version: () => string | null) => Partial<ProbeCacheDeps>
  builds: () => number
} {
  let builds = 0
  return {
    builds: () => builds,
    deps: (version) => ({ build: async () => `probe#${++builds}`, sourceVersion: version }),
  }
}

describe('preview probe cache (dev-invalidation)', () => {
  // Isolate from the real injectProbeIntoHtml tests (shared module cache).
  beforeEach(() => invalidatePreviewProbe())
  afterEach(() => invalidatePreviewProbe())

  test('unchanged source → returns the SAME cached instance, builds once (prod path)', async () => {
    const b = countingBuild()
    const deps = b.deps(() => 'v1')
    const first = await getPreviewProbeJs(deps)
    const second = await getPreviewProbeJs(deps)
    expect(first).toBe('probe#1')
    expect(second).toBe(first) // identity — cache held
    expect(b.builds()).toBe(1)
  })

  test('a null version (production/dist install) holds the cache forever', async () => {
    const b = countingBuild()
    const deps = b.deps(() => null)
    await getPreviewProbeJs(deps)
    await getPreviewProbeJs(deps)
    await getPreviewProbeJs(deps)
    expect(b.builds()).toBe(1)
  })

  test('source content changes (dev-watch edit) → rebuilds a fresh probe', async () => {
    const b = countingBuild()
    let version = 'v1'
    const deps = b.deps(() => version)
    const first = await getPreviewProbeJs(deps)
    expect(first).toBe('probe#1')
    expect(await getPreviewProbeJs(deps)).toBe('probe#1') // no change → cached

    version = 'v2'
    const rebuilt = await getPreviewProbeJs(deps)
    expect(rebuilt).toBe('probe#2')
    expect(rebuilt).not.toBe(first)
    expect(b.builds()).toBe(2)

    // stable again at the new version — one rebuild per edit, not per call
    expect(await getPreviewProbeJs(deps)).toBe('probe#2')
    expect(b.builds()).toBe(2)
  })

  test('a rollback or deletion also invalidates the content version', async () => {
    const b = countingBuild()
    let version = 'newer-tree'
    const deps = b.deps(() => version)
    await getPreviewProbeJs(deps)
    version = 'older-tree'
    await getPreviewProbeJs(deps)
    version = 'newer-tree'
    await getPreviewProbeJs(deps)
    expect(b.builds()).toBe(3)
  })

  test('invalidatePreviewProbe() forces a rebuild on the next call', async () => {
    const b = countingBuild()
    const deps = b.deps(() => 'v1')
    const first = await getPreviewProbeJs(deps)
    invalidatePreviewProbe()
    const second = await getPreviewProbeJs(deps)
    expect(first).toBe('probe#1')
    expect(second).toBe('probe#2') // rebuilt after invalidation
    expect(b.builds()).toBe(2)
  })

  test('concurrent callers share ONE in-flight build', async () => {
    let builds = 0
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const deps: Partial<ProbeCacheDeps> = {
      build: async () => {
        builds++
        await gate
        return `probe#${builds}`
      },
      sourceVersion: () => 'v1',
    }
    const p1 = getPreviewProbeJs(deps)
    const p2 = getPreviewProbeJs(deps)
    release()
    const [a, c] = await Promise.all([p1, p2])
    expect(a).toBe(c) // same instance
    expect(builds).toBe(1) // build invoked exactly once despite two concurrent callers
  })

  test('a failed build clears the in-flight promise so a later call retries', async () => {
    let attempts = 0
    const deps: Partial<ProbeCacheDeps> = {
      build: async () => {
        attempts++
        if (attempts === 1) throw new Error('cold build failed')
        return 'probe#ok'
      },
      sourceVersion: () => 'v1',
    }
    expect(getPreviewProbeJs(deps)).rejects.toThrow('cold build failed')
    // The failure must not poison the cache — the next call retries and succeeds.
    expect(await getPreviewProbeJs(deps)).toBe('probe#ok')
    expect(attempts).toBe(2)
  })
})
