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
type ScanFingerprint = Awaited<ReturnType<typeof buildScanFingerprint>>
/** What a scan found, and the files as they were when it STARTED reading them. */
interface ScanResult {
  plugins: DiscoveredPlugin[]
  fingerprint: ScanFingerprint
}

// A boot's backend host, cache warm and first snapshots may request the same scope
// together. Share only in-flight scans; a later call must still check the filesystem.
const scansInFlight = new Map<string, Promise<ScanResult>>()

export async function scanDirsCached(
  baseDir: string,
  subdirs: string[],
  scope: 'project' | 'global',
  projectId: string,
  opts?: {
    /** The directory scan itself; tests stand in for it to change files while it runs. */
    scan?: typeof scanDirs
  },
): Promise<DiscoveredPlugin[]> {
  const scan = opts?.scan ?? scanDirs
  const roots = subdirs.map((sub) => (sub ? join(baseDir, sub) : baseDir))
  const cacheFile = join(baseDir, '.localix', 'cache', SCAN_CACHE_FILE)
  const scanKey = JSON.stringify({ version: SCAN_CACHE_VERSION, roots, scope, projectId })
  const inFlightKey = JSON.stringify([cacheFile, scanKey])
  // A scan already running may have read the folders before a change this caller must see (a
  // plugin install that just returned): its result is shared only while nothing it read changed.
  const existing = scansInFlight.get(inFlightKey)
  if (existing) {
    const shared = await existing.catch(() => undefined)
    if (shared && (await fingerprintMatches(shared.fingerprint))) return shared.plugins
  }
  const pending = (async (): Promise<ScanResult> => {
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
            // Fingerprint first: a change during the scan then leaves a mismatch, never a stale
            // list stored under the new files' fingerprint.
            const fingerprint = await buildScanFingerprint(roots)
            const actual = await scan(baseDir, subdirs, scope, projectId)
            if (
              JSON.stringify(actual) !== JSON.stringify(cached.plugins) ||
              JSON.stringify(fingerprint) !== JSON.stringify(cached.fingerprint)
            ) {
              await writeScanCache(baseDir, cacheFile, {
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
      return { plugins: cached.plugins, fingerprint: cached.fingerprint }
    }

    // Any version/key/mtime mismatch takes the full-scan path; stale cache data is
    // never returned after a fingerprint mismatch. The fingerprint is taken BEFORE the scan, so a
    // plugin added while it runs leaves a mismatch and the next call scans again.
    const fingerprint = await buildScanFingerprint(roots)
    const plugins = await scan(baseDir, subdirs, scope, projectId)
    await writeScanCache(baseDir, cacheFile, {
      version: SCAN_CACHE_VERSION,
      scanKey,
      fingerprint,
      plugins,
    })
    return { plugins, fingerprint }
  })()
  scansInFlight.set(inFlightKey, pending)
  try {
    return (await pending).plugins
  } finally {
    if (scansInFlight.get(inFlightKey) === pending) scansInFlight.delete(inFlightKey)
  }
}
