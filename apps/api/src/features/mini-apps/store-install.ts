import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { downloadPinned, type DownloadProgress } from '../../lib/pinned-download'
import { unpackMiniAppArchive } from './archive'
import { installCopy, isManagedCopy } from './managed-copy'
import { MINI_APPS_SUBDIR } from './paths'
import type { MiniAppPublisher, Offer } from './store-offers'

/** Beside an app a catalog installed: where it came from, so an update knows it may replace it. */
export const INSTALL_RECORD_FILE = '.localix-install.json'
const INSTALL_RECORD_KIND = 'localix-catalog-install'

export interface InstallRecord {
  kind: typeof INSTALL_RECORD_KIND
  catalog: string
  version: string
  sha256: string
  publisher: MiniAppPublisher
}

export async function readInstallRecord(dir: string): Promise<InstallRecord | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(join(dir, INSTALL_RECORD_FILE), 'utf8'))
    return parsed?.kind === INSTALL_RECORD_KIND ? (parsed as InstallRecord) : null
  } catch {
    return null
  }
}

/**
 * Who put the folder at `dir`: a catalog, an earlier Localix build (before X5, when the app
 * carried copies of its own mini apps: `managed-copy.ts`), the person, or nobody.
 */
export async function installedBy(dir: string): Promise<'catalog' | 'staged' | 'person' | null> {
  if (await readInstallRecord(dir)) return 'catalog'
  if (await isManagedCopy(dir)) return 'staged'
  return (await fs.stat(dir).catch(() => null))?.isDirectory() ? 'person' : null
}

/**
 * Put one offer on this machine: the catalog's archive is downloaded (resumable, sha256-checked),
 * unpacked aside and swapped in with one rename — so a download or archive that fails leaves the
 * version before running.
 */
export async function installOffer(
  offer: Offer,
  homeDir: string,
  opts: { fetchImpl?: typeof fetch; onProgress?: (progress: DownloadProgress) => void } = {},
): Promise<void> {
  const installRoot = join(homeDir, MINI_APPS_SUBDIR)
  const version = offer.version ?? ''
  const archivePath = join(installRoot, '.downloads', `${offer.name}-${version}.tar.gz`)
  await downloadPinned({ name: offer.name, ...offer.archive }, archivePath, {
    fetchImpl: opts.fetchImpl,
    onProgress: opts.onProgress,
  })
  const unpacked = join(installRoot, `.sync-unpack-${offer.name}-${randomUUID()}`)
  try {
    await unpackMiniAppArchive(
      new Uint8Array(await Bun.file(archivePath).arrayBuffer()),
      unpacked,
      {
        name: offer.name,
        version,
      },
    )
    await installCopy(unpacked, join(installRoot, offer.name), {
      file: INSTALL_RECORD_FILE,
      contents: {
        kind: INSTALL_RECORD_KIND,
        catalog: offer.catalog,
        version,
        sha256: offer.archive.sha256,
        publisher: offer.publisher,
      } satisfies InstallRecord,
    })
  } finally {
    await fs.rm(unpacked, { recursive: true, force: true })
    await fs.rm(archivePath, { force: true })
  }
}
