import type { FileContentResponse } from '@/shared/api/contracts'
import { onFilesReloaded } from '@/shared/lib/fileReloadBus'
import { onFsChange } from '@/shared/lib/fsChangeBus'
import { dirName } from '@localixai/mini-app-sdk/ui/utilities'
import { createBoundedCache } from '@localixai/kit/lib'

/** Recently-used clean text snapshots retained after an editor body is evicted. */
export const FILE_CONTENT_CACHE_MAX_ENTRIES = 24
/** Approximate JS heap budget (UTF-16 content + small entry overhead). */
export const FILE_CONTENT_CACHE_MAX_BYTES = 16 * 1024 * 1024

type Entry = {
  sessionId: string
  requestPath: string
  response: FileContentResponse
}

const cacheKey = (sessionId: string, requestPath: string): string =>
  JSON.stringify([sessionId, requestPath])

const entryWeight = (response: FileContentResponse): number =>
  response.content.length * 2 + response.path.length * 2 + 256

/** Only complete, hash-addressable text is safe to serve before revalidation. */
function cacheable(response: FileContentResponse): boolean {
  return (
    response.hash != null &&
    !response.truncated &&
    response.encoding !== 'base64' &&
    !response.mimeType?.startsWith('image/')
  )
}

export interface FileContentCache {
  get(sessionId: string, requestPath: string): FileContentResponse | undefined
  put(sessionId: string, requestPath: string, response: FileContentResponse): boolean
  putText(
    sessionId: string,
    requestPath: string,
    absolutePath: string,
    content: string,
    hash: string,
  ): boolean
  invalidateFiles(paths: ReadonlySet<string>): void
  invalidateDirectories(sessionId: string, paths: readonly string[]): void
  clear(): void
  readonly size: number
  readonly bytes: number
}

/**
 * Byte- and entry-bounded LRU of CLEAN disk snapshots.
 *
 * A hit is never treated as authoritative: `useFileEditor` paints it immediately,
 * then revalidates with its hash. The cache therefore improves first paint without
 * weakening optimistic concurrency or external-change detection.
 */
export function createFileContentCache(
  maxEntries = FILE_CONTENT_CACHE_MAX_ENTRIES,
  maxBytes = FILE_CONTENT_CACHE_MAX_BYTES,
): FileContentCache {
  const entries = createBoundedCache<string, Entry>({
    maxEntries,
    maxWeight: maxBytes,
    weigh: (entry) => entryWeight(entry.response),
  })

  const cache: FileContentCache = {
    get(sessionId, requestPath) {
      return entries.get(cacheKey(sessionId, requestPath))?.response
    },
    put(sessionId, requestPath, response) {
      const key = cacheKey(sessionId, requestPath)
      // An uncacheable response still retires the snapshot it supersedes.
      if (!cacheable(response)) {
        entries.delete(key)
        return false
      }
      return entries.set(key, { sessionId, requestPath, response })
    },
    putText(sessionId, requestPath, absolutePath, content, hash) {
      return cache.put(sessionId, requestPath, {
        path: absolutePath,
        content,
        // Cache consumers use the body/hash; avoid a second full UTF-8 encode on
        // every save just to reproduce server metadata that is not part of identity.
        bytes: content.length,
        truncated: false,
        hash,
      })
    },
    invalidateFiles(paths) {
      entries.deleteWhere((entry) => paths.has(entry.response.path))
    },
    invalidateDirectories(sessionId, paths) {
      entries.deleteWhere(
        (entry) =>
          entry.sessionId === sessionId &&
          (paths.length === 0 || paths.includes(dirName(entry.response.path))),
      )
    },
    clear() {
      entries.clear()
    },
    get size() {
      return entries.size
    },
    get bytes() {
      return entries.weight
    },
  }
  return cache
}

export const fileContentCache = createFileContentCache()

let invalidationInstalled = false

/** Install the process-lifetime invalidation bridge once, after the first editor mounts. */
export function ensureFileContentCacheInvalidation(): void {
  if (invalidationInstalled) return
  invalidationInstalled = true
  onFilesReloaded((paths) => fileContentCache.invalidateFiles(paths))
  onFsChange(({ sessionId, paths }) => fileContentCache.invalidateDirectories(sessionId, paths))
}
