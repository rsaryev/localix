/**
 * Content-addressed extraction cache. Extracting an office/PDF document is
 * expensive (heavy parser libs, big files), so the result is cached on disk under
 * `~/.localix/documents/<hash>.json` — rooted beside the db like the media/table
 * stores. The id is `<contentHash>.json` where `contentHash` = sha256 of the SOURCE
 * bytes fused with the chunk options, so re-extracting the same file with the same
 * window de-dupes for free and the id is stable/verifiable.
 *
 * Agnostic: knows nothing about drivers, formats, or chat — a key + a document in,
 * an id out, the document back. The service owns hashing + orchestration.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteFile } from '@localixai/mini-app-sdk/backend'
import type { ExtractedDocument } from './contracts'

/** Valid cache id: `<64-hex>.json`. Guards the serve route against traversal. */
const ID_RE = /^[a-f0-9]{64}\.json$/

export function isDocumentId(id: string): boolean {
  return ID_RE.test(id)
}

export interface DocumentStore {
  /**
   * Cache an extracted document under a content hash (sha256 hex of the source
   * bytes + options). Returns the cache id (`<hash>.json`). Idempotent: writing the
   * same hash again is a harmless overwrite of identical content (de-dupe for free).
   */
  put(contentHash: string, doc: ExtractedDocument): Promise<{ id: string }>
  /** Read a cached document back by id (`<hash>.json`). Null if invalid/missing. */
  get(id: string): Promise<ExtractedDocument | null>
  /** Cache lookup by the raw content hash (before extraction). Null on a cache miss. */
  getByHash(contentHash: string): Promise<ExtractedDocument | null>
}

/** Content hash for a source: sha256 of the bytes fused with a canonical options key. */
export function hashDocumentInput(bytes: Buffer, optionsKey = ''): string {
  return createHash('sha256').update(bytes).update('\0').update(optionsKey).digest('hex')
}

export interface DocumentStoreOptions {
  /** Root directory for cached extractions (created lazily). */
  dir: string
}

export function createDocumentStore(options: DocumentStoreOptions): DocumentStore {
  const { dir } = options
  let ensured = false
  const ensureDir = async () => {
    if (ensured) return
    await mkdir(dir, { recursive: true })
    ensured = true
  }

  const pathForId = (id: string) => path.join(dir, id)
  const idForHash = (hash: string) => `${hash}.json`

  async function readById(id: string): Promise<ExtractedDocument | null> {
    if (!isDocumentId(id)) return null
    try {
      const buf = await readFile(pathForId(id), 'utf8')
      return JSON.parse(buf) as ExtractedDocument
    } catch {
      return null
    }
  }

  return {
    async put(contentHash, doc) {
      const id = idForHash(contentHash)
      await ensureDir()
      const target = pathForId(id)
      // Content-addressed: if a cache file with this hash already exists, the write
      // is a harmless overwrite of identical content — skip it to save the IO.
      try {
        await stat(target)
        return { id }
      } catch {
        // not present — fall through to an atomic write
      }
      // A unique temp sibling, not a fixed `${target}.tmp`: two concurrent extractions of the same
      // file raced on that one name, and the second rename failed with ENOENT.
      await atomicWriteFile(target, JSON.stringify(doc))
      return { id }
    },

    get(id) {
      return readById(id)
    },

    getByHash(contentHash) {
      return readById(idForHash(contentHash))
    },
  }
}
