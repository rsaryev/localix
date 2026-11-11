import { InvalidRequestError } from '../../lib/domain-errors'
import { ApiError, errorMessage } from '../../lib/errors'
import { rmrf } from '../ext/install-tree'
import { catalogHop, fetchChecked, readCapped } from './marketplace-download'
import { judgedArchive } from './kit'
import { extractZipMembers } from './marketplace-zip-extract'
import { scanZip } from './marketplace-zip-scan'
import type { ArchiveFetchPlan } from '@rsaryev/llx-plugin/marketplace'

/** Headers for a download URL: given only on `origin` (same scheme, host and port). */
function onOrigin(
  origin: string,
  headers: Readonly<Record<string, string>> | undefined,
): (url: URL) => Readonly<Record<string, string>> | undefined {
  return (url) => (headers && url.origin === origin ? headers : undefined)
}

/**
 * Claude Code's `archive` plugin source and hosted (`url`) marketplace catalogs. An archive is the
 * kit's to judge (`fetchArchive`) and Localix's to write (`extractZipMembers`); a catalog is fetched
 * over HTTP(S) within Claude Code's download limits (`marketplace-download.ts`).
 */

const MiB = 1024 * 1024
export const MAX_CATALOG_BYTES = 5 * MiB
export const CATALOG_TIMEOUT_MS = 10_000

/** Download a hosted `marketplace.json` (http or https) as text, within the size ceiling. */
export async function fetchCatalogText(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<string> {
  if (!/^https?:\/\//i.test(url))
    throw new InvalidRequestError('marketplace_bad_source', `Not an http(s) URL: ${url}`)
  const download = {
    what: `Downloading ${url}`,
    timeoutMs: opts.timeoutMs ?? CATALOG_TIMEOUT_MS,
    checkHop: catalogHop,
    code: 'marketplace_fetch_failed',
    // A redirect elsewhere gets no headers: they belong to the catalog's own origin.
    headers: opts.headers ? onOrigin(new URL(url).origin, opts.headers) : undefined,
  }
  const { response } = await fetchChecked(url, download)
  const bytes = await readCapped(response, MAX_CATALOG_BYTES, {
    ...download,
    what: 'The marketplace catalog',
    tooLargeCode: 'marketplace_download_too_large',
  })
  return bytes.toString('utf8')
}

/**
 * Download an archive source with the kit (`fetchArchive`: https and the blocked hosts on every
 * hop, the size, the pin, the extraction limits, the plugin root, every path and link) and write
 * the members it judged into `dest` (created, previous content replaced), so `dest` IS the plugin
 * directory — the shape the git and npm paths stage. A refusal throws with the kit's message.
 */
export async function fetchArchivePlugin(plan: ArchiveFetchPlan, dest: string): Promise<void> {
  const { zip, root } = await judgedArchive(plan)
  await rmrf(dest)
  try {
    await extractZipMembers(zip, scanZip(zip).members, root, dest)
  } catch (err) {
    await rmrf(dest)
    if (err instanceof ApiError) throw err
    throw new InvalidRequestError(
      'plugin_archive_extract_failed',
      `Extracting ${plan.url} failed: ${errorMessage(err)}`,
    )
  }
}
