import { stat } from 'node:fs/promises'
import { createBoundedCache } from '../../../lib/bounded-cache'

const LOCAL_TEXT_SNAPSHOT_LIMIT = 256

/**
 * How long after its last change a file's metadata cannot vouch for its content. A filesystem
 * clock ticks coarsely (a few milliseconds on Linux, a second on HFS+, two on FAT), so two
 * same-size writes inside one tick leave identical metadata. Like git's "racily clean" entries, a
 * file changed this close to its snapshot is read and hashed again instead.
 */
const RACY_WINDOW_NS = 2_000_000_000n

interface LocalFileIdentity {
  fingerprint: string
  bytes: number
  /** The later of the file's mtime and ctime, in nanoseconds since the epoch. */
  changedNs: bigint
}

interface LocalTextSnapshot extends LocalFileIdentity {
  hash: string
}

/**
 * Recently verified local text snapshots. A conditional editor revalidation can
 * compare the file's cheap kernel metadata with this identity before deciding to
 * read and SHA-256 the body again. The content hash remains the write-concurrency
 * token; metadata is only a read-avoidance hint, and any mismatch falls back to
 * the complete read.
 */
const localTextSnapshots = createBoundedCache<string, LocalTextSnapshot>({
  maxEntries: LOCAL_TEXT_SNAPSHOT_LIMIT,
})

export async function localFileIdentity(
  resolved: string,
  signal?: AbortSignal,
): Promise<LocalFileIdentity | null> {
  try {
    signal?.throwIfAborted()
    const value = await stat(resolved, { bigint: true })
    signal?.throwIfAborted()
    if (!value.isFile()) return null
    return {
      // ctime closes the same-size + restored-mtime hole left by the common
      // mtime/size etag; inode/device also detect atomic replacement.
      fingerprint: [
        value.dev,
        value.ino,
        value.mode,
        value.size,
        value.mtimeNs,
        value.ctimeNs,
      ].join(':'),
      bytes: Number(value.size),
      changedNs: value.mtimeNs > value.ctimeNs ? value.mtimeNs : value.ctimeNs,
    }
  } catch (error) {
    if (signal?.aborted) throw error
    return null
  }
}

export function rememberLocalTextSnapshot(
  resolved: string,
  identity: LocalFileIdentity,
  hash: string,
  now: () => number = Date.now,
): void {
  if (BigInt(now()) * 1_000_000n - identity.changedNs < RACY_WINDOW_NS) {
    localTextSnapshots.delete(resolved)
    return
  }
  localTextSnapshots.set(resolved, { ...identity, hash })
}

export function knownLocalTextSnapshot(
  resolved: string,
  identity: LocalFileIdentity,
  knownHash: string,
): LocalTextSnapshot | null {
  // Peek first: only a snapshot that still matches counts as a use and is kept fresh.
  const snapshot = localTextSnapshots.peek(resolved)
  if (
    !snapshot ||
    snapshot.hash !== knownHash ||
    snapshot.fingerprint !== identity.fingerprint ||
    snapshot.bytes !== identity.bytes
  )
    return null
  localTextSnapshots.get(resolved)
  return snapshot
}
