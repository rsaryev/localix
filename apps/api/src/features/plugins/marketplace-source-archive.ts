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

const execFileAsync = promisify(execFile)

/**
 * Claude Code's `archive` plugin source and hosted (`url`) marketplace catalogs: files fetched
 * over HTTP(S) with a size ceiling. An archive is a zip over `https://` (never a loopback,
 * link-local or cloud-metadata host), checked against its `sha256` pin when the entry sets one,
 * and unpacked with the plugin at its top or one folder down.
 */

export const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
export const MAX_CATALOG_BYTES = 10 * 1024 * 1024

/** Hosts an archive URL may not name: this machine, link-local space, cloud metadata. */
function isForbiddenHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.startsWith('127.') ||
    host.startsWith('169.254.') ||
    host.startsWith('fe80:') ||
    host === 'metadata.google.internal' ||
    host === '100.100.100.200'
  )
}

async function fetchOk(url: string, what: string): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, { redirect: 'follow' })
  } catch (err) {
    throw new InvalidRequestError(
      'marketplace_fetch_failed',
      `${what} failed: ${errorMessage(err)}`,
    )
  }
  if (!res.ok)
    throw new InvalidRequestError(
      'marketplace_fetch_failed',
      `${what} failed: HTTP ${res.status} ${url}`,
    )
  return res
}

/** Read a response body, refusing one larger than `maxBytes` before it is all in memory. */
async function readCapped(res: Response, maxBytes: number, what: string): Promise<Buffer> {
  const tooLarge = () =>
    new UnprocessableError('marketplace_download_too_large', `${what} exceeds ${maxBytes} bytes`)
  if (Number(res.headers.get('content-length')) > maxBytes) throw tooLarge()
  const reader = res.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw tooLarge()
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

/** Download a hosted `marketplace.json` (http or https) as text, within the size ceiling. */
export async function fetchCatalogText(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url))
    throw new InvalidRequestError('marketplace_bad_source', `Not an http(s) URL: ${url}`)
  const what = 'The marketplace catalog'
  const res = await fetchOk(url, `Downloading ${url}`)
  return (await readCapped(res, MAX_CATALOG_BYTES, what)).toString('utf8')
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
  src: { url: string; sha256?: string },
  dest: string,
): Promise<void> {
  const parsed = new URL(src.url)
  if (parsed.protocol !== 'https:' || isForbiddenHost(parsed.hostname))
    throw new InvalidRequestError(
      'marketplace_bad_source',
      `Archive sources must be https:// on a public host: ${src.url}`,
    )
  const res = await fetchOk(src.url, `Downloading ${src.url}`)
  const file = join(tmpdir(), `localix-archive-${randomUUID()}.zip`)
  const unpacked = join(tmpdir(), `localix-archive-${randomUUID()}`)
  try {
    const bytes = await readCapped(res, MAX_ARCHIVE_BYTES, `Archive ${src.url}`)
    if (src.sha256) {
      const got = createHash('sha256').update(bytes).digest('hex')
      if (got !== src.sha256)
        throw new UnprocessableError(
          'plugin_archive_integrity',
          `Archive ${src.url} does not match its sha256 pin (expected ${src.sha256}, got ${got})`,
        )
    }
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
