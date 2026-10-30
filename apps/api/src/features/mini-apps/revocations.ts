import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../db/types'
import { recordCoreChanges } from '../changes/core-entities'
import { readRevocation, REVOCATION_FILE, type RevocationMark } from './revocation-file'
import { readInstallRecord, type InstallRecord } from './store-install'
import type { OfferRead } from './store-offers'

/**
 * INSTALLED APPS THEIR MARKETPLACE TOOK BACK (`docs/extending/mini-app-marketplace.md`,
 * "Revoking"): an app revoked as a whole or at the version installed, or a build Localix blocks
 * by its archive's sha256, is marked in its folder (`revocation-file.ts`), and the gate every
 * host asks before importing an app's code (`loadable.ts`) does not run it. Every fresh read of
 * the marketplaces is reconciled against what is installed, so the marks are derived from the
 * marketplaces and the install records and rebuilt by the next read; each change is announced as
 * a `mini-app` notice once the marks are written, so every host re-reads.
 *
 * A marketplace that says nothing — offline, unreadable — takes nothing back: an app stops being
 * revoked only when its marketplace offers it again, or when what is installed is no longer the
 * build taken back (an update or a removal replaces the folder, and the mark with it).
 */
export function createMiniAppRevocations(deps: { db: Kysely<AppDatabase>; installRoot: string }) {
  /** Every app a marketplace installed here, by name, with its install record and mark. */
  async function installed() {
    const names = await fs.readdir(deps.installRoot).catch(() => [] as string[])
    const apps = await Promise.all(
      names
        .filter((name) => !name.startsWith('.'))
        .map(async (name) => {
          const dir = join(deps.installRoot, name)
          const record = await readInstallRecord(dir)
          return record ? [{ name, dir, record, mark: await readRevocation(dir) }] : []
        }),
    )
    return apps.flat()
  }

  /** Why the installed build of `name` is taken back, or null. */
  function reasonFor(
    name: string,
    record: InstallRecord,
    read: Pick<OfferRead, 'revocations' | 'blocked'>,
  ): string | null {
    const id = `${name}@${record.marketplace}`
    const revoked = read.revocations.find(
      (found) => found.id === id && (!found.versions || found.versions.includes(record.version)),
    )
    if (revoked) return revoked.reason
    const blocked = read.blocked.find((found) => found.sha256 === record.sha256)
    return blocked ? `Localix blocks this build: ${blocked.reason}` : null
  }

  return {
    /** The installed apps not to run, by name, each with why. */
    async revoked(): Promise<Map<string, string>> {
      return new Map(
        (await installed()).flatMap(({ name, mark }) => (mark ? [[name, mark.reason]] : [])),
      )
    },

    /** Bring the marks in line with one read of the marketplaces; idempotent. */
    async reconcile(read: Pick<OfferRead, 'offers' | 'revocations' | 'blocked'>): Promise<void> {
      const changed: string[] = []
      for (const { name, dir, record, mark } of await installed()) {
        const reason = reasonFor(name, record, read)
        const same = mark?.marketplace === record.marketplace && mark.version === record.version
        if (reason) {
          if (same && mark.reason === reason) continue
          const next: RevocationMark = {
            marketplace: record.marketplace,
            version: record.version,
            reason,
          }
          await fs.writeFile(join(dir, REVOCATION_FILE), `${JSON.stringify(next, null, 2)}\n`)
          changed.push(name)
        } else if (mark && (!same || read.offers.has(`${name}@${record.marketplace}`))) {
          await fs.rm(join(dir, REVOCATION_FILE), { force: true })
          changed.push(name)
        }
      }
      if (changed.length)
        await recordCoreChanges(
          deps.db,
          changed.map((name) => ({
            entity: 'mini-app' as const,
            op: 'upserted' as const,
            ref: { id: name, scope: 'global' as const },
          })),
        )
    },
  }
}

export type MiniAppRevocations = ReturnType<typeof createMiniAppRevocations>
