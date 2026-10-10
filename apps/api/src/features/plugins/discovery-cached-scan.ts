import { join } from 'node:path'
import type { DiscoveredPlugin } from './discovery-types'
import { scanDirs } from './discovery-directory-scan'

import {
  SCAN_CACHE_VERSION,
  SCAN_CACHE_FILE,
  fingerprintPath,
  buildScanFingerprint,
  fingerprintMatches,
  readScanCache,
  writeScanCache,
} from './discovery-scan-cache'

const SCAN_CACHE_REVALIDATE_MS = 3_000

const scanCacheRevalidations = new Map<string, Promise<void>>()
// A boot's backend host, cache warm and first snapshots may request the same scope
// together. Share only in-flight scans; a later call must still check the filesystem.
const scansInFlight = new Map<string, Promise<DiscoveredPlugin[]>>()

export async function scanDirsCached(
  baseDir: string,
  subdirs: string[],
  scope: 'project' | 'global',
  projectId: string,
  opts?: {
    bundledNames?: ReadonlySet<string>
  },
): Promise<DiscoveredPlugin[]> {
  const roots = subdirs.map((sub) => (sub ? join(baseDir, sub) : baseDir))
  const cacheFile = join(baseDir, '.localix', 'cache', SCAN_CACHE_FILE)
  const bundledNames = [...(opts?.bundledNames ?? [])].sort()
  const scanKey = JSON.stringify({
    version: SCAN_CACHE_VERSION,
    roots,
    scope,
    projectId,
    bundledNames,
  })
  const inFlightKey = JSON.stringify([cacheFile, scanKey])
  const existing = scansInFlight.get(inFlightKey)
  if (existing) return existing
  const pending = (async () => {
    const cached = await readScanCache(cacheFile)

    if (
      cached?.scanKey === scanKey &&
      cached.fingerprint.length > 0 &&
      (await fingerprintMatches(cached.fingerprint))
    ) {
      /**
       * Return the mtime/version-keyed cache immediately, then throttle a real scan off
       * the critical path.
       * Keep one validator per cache file; if reality differs it atomically replaces
       * the cache, so the next read cannot keep winning with stale data.
       */
      if (!scanCacheRevalidations.has(cacheFile)) {
        const validation = new Promise<void>((resolveDelay) => {
          const timer = setTimeout(resolveDelay, SCAN_CACHE_REVALIDATE_MS)
          timer.unref?.()
        })
          .then(async () => {
            // Test fixtures and deleted workspaces can disappear before the deferred pass.
            if (!(await fingerprintPath(baseDir))) return
            const actual = await scanDirs(baseDir, subdirs, scope, projectId, opts)
            const fingerprint = await buildScanFingerprint(roots)
            if (
              JSON.stringify(actual) !== JSON.stringify(cached.plugins) ||
              JSON.stringify(fingerprint) !== JSON.stringify(cached.fingerprint)
            ) {
              await writeScanCache(cacheFile, {
                version: SCAN_CACHE_VERSION,
                scanKey,
                fingerprint,
                plugins: actual,
              })
            }
          })
          .finally(() => scanCacheRevalidations.delete(cacheFile))
        scanCacheRevalidations.set(cacheFile, validation)
      }
      return cached.plugins
    }

    // Any version/key/mtime mismatch takes the full-scan path; stale cache data is
    // never returned after a fingerprint mismatch.
    const plugins = await scanDirs(baseDir, subdirs, scope, projectId, opts)
    await writeScanCache(cacheFile, {
      version: SCAN_CACHE_VERSION,
      scanKey,
      fingerprint: await buildScanFingerprint(roots),
      plugins,
    })
    return plugins
  })()
  scansInFlight.set(inFlightKey, pending)
  try {
    return await pending
  } finally {
    if (scansInFlight.get(inFlightKey) === pending) scansInFlight.delete(inFlightKey)
  }
}
