import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { downloadPinned, type DownloadProgress } from '../../lib/pinned-download'
import { unpackMiniAppArchive } from './archive'
import { installCopy, isManagedCopy } from './managed-copy'
import { MINI_APPS_SUBDIR } from './paths'
import type { MiniAppPublisher, Offer } from './store-offers'

/**
 * Beside an app a marketplace installed: which app it is — its identity is its name and the
 * marketplace's (`docs/extending/mini-app-marketplace.md`, "Identity") — so only that marketplace
 * updates or revokes it, and the archive it came from, which Localix may block.
 */
export const INSTALL_RECORD_FILE = '.localix-install.json'
const INSTALL_RECORD_KIND = 'localix-marketplace-install'

export interface InstallRecord {
  kind: typeof INSTALL_RECORD_KIND
  /** The marketplace it is offered by, by name: half of its identity. */
  marketplace: string
  /** The released marketplace its archive came from. */
  url: string
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

/** What a catalog of a release before marketplaces wrote beside the app it installed. */
const CATALOG_INSTALL_KIND = 'localix-catalog-install'

async function installedByCatalog(dir: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await fs.readFile(join(dir, INSTALL_RECORD_FILE), 'utf8'))
    return parsed?.kind === CATALOG_INSTALL_KIND
  } catch {
    return false
  }
}

/**
 * Who put the folder at `dir`: a marketplace, an earlier Localix build (before X5, when the app
 * carried copies of its own mini apps: `managed-copy.ts`, or a catalog of a release before
 * marketplaces, whose record names no marketplace), the person, or nobody. What an earlier build
 * put there is Localix's own: the marketplace Localix vouches for takes it over (`holdsOffer`).
 */
export async function installedBy(
  dir: string,
): Promise<'marketplace' | 'staged' | 'person' | null> {
  if (await readInstallRecord(dir)) return 'marketplace'
  if ((await isManagedCopy(dir)) || (await installedByCatalog(dir))) return 'staged'
  return (await fs.stat(dir).catch(() => null))?.isDirectory() ? 'person' : null
}

/**
 * Put one offer on this machine: its marketplace's archive is downloaded (resumable, sha256-checked),
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
        marketplace: offer.marketplace,
        url: offer.from,
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
