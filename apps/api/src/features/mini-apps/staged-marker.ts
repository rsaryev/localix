import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { MARKER_FILE } from './managed-copy'
import { isRecord } from '../../lib/record'

/**
 * What a staged plugins root says about itself, and whether that can be believed.
 *
 * The stager (`scripts/stage-dropins.mjs`) writes one marker per root, LAST: a content hash per
 * staged plugin and the reason for each plugin it could not build. The sync trusts those hashes
 * only when nothing in the tree changed after the marker was written; a marker it cannot trust is
 * `null`, and every consumer then falls back to walking the tree itself.
 */

/** Written LAST by staging, so its rewrite is the one event that means "this root is complete". */
export const STAGED_MARKER_FILE = '.localix-staged.json'
const STAGED_MARKER_KIND = 'localix-staged-plugins'
const STAGED_MARKER_SCHEMA_VERSION = 3
const STAGED_HASH_ALGORITHM = 'sha256'
const SHA256_HEX_RE = /^[0-9a-f]{64}$/u

export interface StagedMarker {
  pluginHashes: Record<string, string>
  /** Plugins the stager could not build, with the reason; they have no staged directory. */
  unavailable: Record<string, string>
  writtenAtNs: bigint
}

export async function readStagedMarker(root: string): Promise<StagedMarker | null> {
  try {
    const markerPath = join(root, STAGED_MARKER_FILE)
    const pathStat = await fs.lstat(markerPath, { bigint: true })
    if (!pathStat.isFile()) return null
    const handle = await fs.open(markerPath, 'r')
    try {
      const parsed = JSON.parse(await handle.readFile('utf8')) as Record<string, unknown>
      const stat = await handle.stat({ bigint: true })
      if (stat.dev !== pathStat.dev || stat.ino !== pathStat.ino) return null
      const { pluginHashes, unavailable } = parsed
      if (
        parsed.kind !== STAGED_MARKER_KIND ||
        parsed.schemaVersion !== STAGED_MARKER_SCHEMA_VERSION ||
        parsed.hashAlgorithm !== STAGED_HASH_ALGORITHM ||
        !isRecord(pluginHashes) ||
        !isRecord(unavailable)
      ) {
        return null
      }
      for (const [name, hash] of Object.entries(pluginHashes)) {
        if (!name || typeof hash !== 'string' || !SHA256_HEX_RE.test(hash)) return null
      }
      // A plugin cannot be both staged and unavailable; a marker that says so is not a record of
      // one staging run.
      for (const [name, reason] of Object.entries(unavailable)) {
        if (!name || typeof reason !== 'string' || name in pluginHashes) return null
      }
      return {
        pluginHashes: pluginHashes as Record<string, string>,
        unavailable: unavailable as Record<string, string>,
        writtenAtNs: stat.mtimeNs,
      }
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}

/**
 * The packager replaces the staging root and writes its marker only after every
 * plugin hash is complete. File/link content or mode edits advance ctime even when
 * mtime is restored; additions and removals advance their parent directory's ctime.
 * Any entry that does not strictly predate the marker therefore means it may be
 * leftover metadata. Equality is ambiguous on filesystems with coarse timestamp
 * resolution, so every plugin falls back to the content fingerprint.
 */
async function treePredatesMarker(root: string, markerWrittenAtNs: bigint): Promise<boolean> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === MARKER_FILE) continue
      const path = join(root, entry.name)
      const stat = await fs.lstat(path, { bigint: true })
      if (stat.ctimeNs >= markerWrittenAtNs) return false
      if (entry.isDirectory() && !(await treePredatesMarker(path, markerWrittenAtNs))) return false
    }
    return true
  } catch {
    return false
  }
}

/** The marker, when it describes exactly `pluginNames` and no staged tree changed after it. */
export async function validateStagedMarker(
  sourceRoot: string,
  pluginNames: ReadonlySet<string>,
): Promise<StagedMarker | null> {
  const marker = await readStagedMarker(sourceRoot)
  if (!marker) return null
  if (Object.keys(marker.pluginHashes).some((name) => !pluginNames.has(name))) return null
  for (const name of pluginNames) {
    if (!(await treePredatesMarker(join(sourceRoot, name), marker.writtenAtNs))) return null
  }
  return marker
}
