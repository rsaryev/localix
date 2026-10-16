import { stat } from 'node:fs/promises'
import { createBoundedCache } from '../../../lib/bounded-cache'

const LOCAL_TEXT_SNAPSHOT_LIMIT = 256

interface LocalFileIdentity {
  fingerprint: string
  bytes: number
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
): void {
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
