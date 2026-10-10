import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { DiscoveredPlugin } from './discovery-types'

export const SCAN_CACHE_VERSION = 1
export const SCAN_CACHE_FILE = 'plugin-scan-cache-v1.json'

interface ScanFingerprintEntry {
  path: string
  mtimeMs: number
  size: number
  directory: boolean
}

interface PluginScanCache {
  version: number
  scanKey: string
  fingerprint: ScanFingerprintEntry[]
  plugins: DiscoveredPlugin[]
}

export async function fingerprintPath(path: string): Promise<ScanFingerprintEntry | null> {
  try {
    const stat = await fs.stat(path)
    return {
      path,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      directory: stat.isDirectory(),
    }
  } catch {
    return null
  }
}

/**
 * Record every directory entry once after a real scan. Later boots only `stat`
 * these known paths in parallel: a file edit changes its own mtime/size, while an
 * add/remove/rename changes the containing directory's mtime. This is the same
 * evidence boundary as a directory fingerprint, widened to every
 * discovery-bearing file so an unchanged fingerprint cannot hide a command,
 * agent, hook, or manifest edit.
 */
export async function buildScanFingerprint(roots: string[]): Promise<ScanFingerprintEntry[]> {
  const found: ScanFingerprintEntry[] = []

  async function visit(path: string): Promise<void> {
    const entry = await fingerprintPath(path)
    if (!entry) {
      found.push({ path, mtimeMs: -1, size: -1, directory: false })
      return
    }
    found.push(entry)
    if (!entry.directory) return
    let names: string[]
    try {
      names = await fs.readdir(path)
    } catch {
      return
    }
    await Promise.all(names.map((name) => visit(join(path, name))))
  }

  await Promise.all(roots.map(visit))
  return found.sort((a, b) => a.path.localeCompare(b.path))
}

export async function fingerprintMatches(expected: ScanFingerprintEntry[]): Promise<boolean> {
  const actual = await Promise.all(expected.map((entry) => fingerprintPath(entry.path)))
  return actual.every((entry, index) => {
    const wanted = expected[index]
    if (wanted.mtimeMs === -1) return entry === null
    return (
      entry !== null &&
      entry.mtimeMs === wanted.mtimeMs &&
      entry.size === wanted.size &&
      entry.directory === wanted.directory
    )
  })
}

export async function readScanCache(cacheFile: string): Promise<PluginScanCache | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(cacheFile, 'utf8')) as Partial<PluginScanCache>
    if (
      parsed.version !== SCAN_CACHE_VERSION ||
      typeof parsed.scanKey !== 'string' ||
      !Array.isArray(parsed.fingerprint) ||
      !Array.isArray(parsed.plugins) ||
      parsed.fingerprint.some(
        (entry) =>
          !entry ||
          typeof entry.path !== 'string' ||
          typeof entry.mtimeMs !== 'number' ||
          typeof entry.size !== 'number' ||
          typeof entry.directory !== 'boolean',
      )
    ) {
      return null
    }
    return parsed as PluginScanCache
  } catch {
    return null
  }
}

export async function writeScanCache(cacheFile: string, cache: PluginScanCache): Promise<void> {
  try {
    await fs.mkdir(dirname(cacheFile), { recursive: true })
    const temp = `${cacheFile}.${process.pid}.${crypto.randomUUID()}.tmp`
    await fs.writeFile(temp, JSON.stringify(cache))
    await fs.rename(temp, cacheFile)
  } catch {
    // A read-only install root only loses the optimization; discovery still succeeds.
  }
}
