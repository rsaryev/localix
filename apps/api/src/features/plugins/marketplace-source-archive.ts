import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { InvalidRequestError, UnprocessableError } from '../../lib/domain-errors'
import { ApiError, errorMessage } from '../../lib/errors'
import { childEnv } from '../../lib/login-shell-env'
import { rmrf } from '../ext/install-tree'
import { catalogHop, fetchChecked, httpsPublicHop, readCapped } from './marketplace-download'
import { onOrigin } from './marketplace-headers'
import { verifyZipMembers } from './marketplace-zip-inflate'
import { scanZip, type ZipLimits } from './marketplace-zip-scan'

const execFileAsync = promisify(execFile)

/**
 * Claude Code's `archive` plugin source and hosted (`url`) marketplace catalogs: files fetched
 * over HTTP(S) within Claude Code's download limits (`marketplace-download.ts`). An archive is a
 * zip over `https://` (never a loopback, link-local or cloud-metadata host, on every redirect
 * hop), checked against its `sha256` pin when the entry sets one, its central directory checked
 * against the extraction limits and every entry inflated against its declared size before `unzip`
 * runs, and unpacked with the plugin at its top or one folder down.
 */

const MiB = 1024 * 1024
export const MAX_ARCHIVE_BYTES = 256 * MiB
export const MAX_CATALOG_BYTES = 5 * MiB
export const ARCHIVE_TIMEOUT_MS = 120_000
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

/** The extracted folder holding the plugin: the archive's top, or its single top-level folder. */
async function pluginRootOf(dir: string): Promise<string> {
  const entries = (await fs.readdir(dir, { withFileTypes: true })).filter(
    (entry) => entry.name !== '__MACOSX',
  )
  const only = entries.length === 1 ? entries[0] : undefined
  return only?.isDirectory() ? join(dir, only.name) : dir
}

/**
 * Download + verify + unzip an archive source into `dest` (created, previous content replaced),
 * so `dest` IS the plugin directory — the shape the git and npm paths stage.
 */
export async function fetchArchivePlugin(
  src: { url: string; sha256?: string; headers?: Record<string, string> },
  dest: string,
  opts: { timeoutMs?: number; limits?: ZipLimits } = {},
): Promise<void> {
  const parsed = URL.canParse(src.url) ? new URL(src.url) : null
  if (!parsed || httpsPublicHop(parsed, null))
    throw new InvalidRequestError(
      'marketplace_bad_source',
      `Archive sources must be https:// on a public host: ${src.url}`,
    )
  // Every redirect hop is held to the same rule, at most five of them.
  const download = {
    what: `Downloading ${src.url}`,
    timeoutMs: opts.timeoutMs ?? ARCHIVE_TIMEOUT_MS,
    checkHop: httpsPublicHop,
    code: 'marketplace_fetch_failed',
    headers: src.headers ? onOrigin(new URL(src.url).origin, src.headers) : undefined,
  }
  const { response } = await fetchChecked(src.url, download)
  const file = join(tmpdir(), `localix-archive-${randomUUID()}.zip`)
  const unpacked = join(tmpdir(), `localix-archive-${randomUUID()}`)
  try {
    const bytes = await readCapped(response, MAX_ARCHIVE_BYTES, {
      ...download,
      what: `Archive ${src.url}`,
      tooLargeCode: 'marketplace_download_too_large',
    })
    if (src.sha256) {
      const got = createHash('sha256').update(bytes).digest('hex')
      if (got !== src.sha256)
        throw new UnprocessableError(
          'plugin_archive_integrity',
          `Archive ${src.url} does not match its sha256 pin (expected ${src.sha256}, got ${got})`,
        )
    }
    // Refuse a zip bomb before anything is unpacked: from its central directory, then by
    // inflating each entry into a counter, since `unzip` writes what inflates, not what is declared.
    await verifyZipMembers(bytes, scanZip(bytes, opts.limits).members)
    await fs.writeFile(file, bytes)
    await fs.mkdir(unpacked, { recursive: true })
    // `unzip` skips entries with `..` or absolute paths, so nothing lands outside `unpacked`.
    await execFileAsync('unzip', ['-q', '-o', file, '-d', unpacked], {
      timeout: 60_000,
      env: childEnv(),
      windowsHide: true,
    })
    await rmrf(dest)
    await fs.cp(await pluginRootOf(unpacked), dest, { recursive: true, verbatimSymlinks: true })
  } catch (err) {
    await rmrf(dest)
    if (err instanceof ApiError) throw err
    throw new InvalidRequestError(
      'plugin_archive_extract_failed',
      `Extracting ${src.url} failed: ${errorMessage(err)}`,
    )
  } finally {
    await rmrf(file)
    await rmrf(unpacked)
  }
}
