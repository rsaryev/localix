import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteFile } from '@localixai/plugin-sdk/backend'

import { localixHome } from '../../lib/env'

/**
 * The runtime adapter's persistence contract, restated here rather than imported.
 *
 * A feature may not depend on the pi implementation — only the composition root
 * may (enforced by `scripts/check-architecture.mjs`), and this is the same
 * engine-neutral idiom `CatalogSource` in `./service.ts` already follows. The two
 * shapes are checked against each other where they actually meet: `bootstrap.ts`
 * fails to compile if the adapter's contract drifts from this one.
 */
export interface CatalogMetadataSnapshot {
  fetchedAt: number
  releaseDates: Record<string, string>
}

export interface CatalogMetadataStore {
  read(): CatalogMetadataSnapshot | undefined
  write(snapshot: CatalogMetadataSnapshot): Promise<void>
}

/**
 * Where the pi catalog's OpenRouter metadata lives between runs.
 *
 * The runtime package owns the caching POLICY (when to refresh) and deliberately
 * knows nothing about the filesystem; this is the host half of that seam —
 * machine-level state, so it roots at {@link localixHome} alongside the vault and
 * the login-shell snapshot rather than beside a project's database.
 *
 * The write replaces the file atomically (temp file + rename). Written in place, a quit or a
 * full disk mid-write left truncated JSON behind, and the next launch silently started from the
 * generated metadata again.
 *
 * Both methods are allowed to throw: the runtime treats any failure as "no cache"
 * and serves the generated metadata, so a corrupt file or a read-only home degrades
 * to exactly the behaviour that existed before this cache.
 */
export function createCatalogMetadataStore(
  file: string = join(localixHome(), 'catalog-metadata.json'),
): CatalogMetadataStore {
  return {
    read() {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as CatalogMetadataSnapshot
      if (typeof parsed?.fetchedAt !== 'number') return undefined
      if (!parsed.releaseDates || typeof parsed.releaseDates !== 'object') return undefined
      return parsed
    },
    write: (snapshot) => atomicWriteFile(file, JSON.stringify(snapshot)),
  }
}
