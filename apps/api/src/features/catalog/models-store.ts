import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from '@localixai/mini-app-sdk/backend'
import type { EngineCatalogStore } from '@localixai/agent/runtime'

import { localixHome } from '../../lib/env'

/** Provider ids are slugs; one names a file, so anything else is refused rather than resolved. */
const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u

function fileFor(dir: string, providerId: string): string {
  if (!PROVIDER_ID.test(providerId) || providerId.includes('..')) {
    throw new Error(`Invalid provider id for the model catalog store: ${providerId}`)
  }
  return join(dir, `${providerId}.json`)
}

/**
 * Where refreshed model catalogs live between launches: one JSON file per provider under
 * `~/.localix/model-catalog/`.
 *
 * Machine-level state, like the vault and the login-shell snapshot, so it roots at
 * {@link localixHome} rather than beside a project's database. The runtime adapter owns the
 * entry's shape and validates what it reads back, dropping (and deleting) an entry it does not
 * accept, so this store only keeps bytes: a missing file reads as no entry, and a file that is
 * not JSON throws, which the adapter treats the same way. Writes replace the file atomically, so a
 * quit or a full disk mid-write leaves the previous entry rather than truncated JSON.
 */
export function createModelCatalogStore(
  dir: string = join(localixHome(), 'model-catalog'),
): EngineCatalogStore {
  return {
    async read(providerId) {
      let text: string
      try {
        text = await readFile(fileFor(dir, providerId), 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
      return JSON.parse(text) as unknown
    },
    async write(providerId, entry) {
      await atomicWriteFile(fileFor(dir, providerId), JSON.stringify(entry))
    },
    async delete(providerId) {
      await rm(fileFor(dir, providerId), { force: true })
    },
  }
}
