import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

import { errorMessage } from '../../lib/errors'
import type { MiniAppStore } from './store'

/**
 * MINI APPS INSTALLED BY DEFAULT, on their own on a new installation.
 *
 * A marketplace Localix vouches for marks a few of its apps `installByDefault`; this pass installs
 * them in the background on the first start, without asking, because they are Localix's own and
 * verified (rule X5 holds: they come from the marketplace like any other app, and the core names
 * none of them, X4).
 *
 * - **Once per app.** Every app it has offered is remembered by identity in a marker under
 *   `~/.localix`, so one the person removes is never added again; a marketplace that marks a new
 *   app later offers that one once too.
 * - **First start only.** An installation that already has mini apps is not new: the marker is
 *   seeded with what is recommended and nothing is installed over the person's choices.
 * - **Offline is later.** A marketplace that cannot be read, or an install that fails, leaves that app
 *   unmarked and answers `retry`; the caller runs the pass again (`bootstrap/ops-timers.ts`).
 * - **Never over the person's own folder**: the store refuses that name, and the app counts as
 *   offered.
 *
 * Progress shows where every install does (the Event Center's "In progress"), and the outcome is
 * the store's ordinary journal fact ("Installed 3 mini apps").
 */

export const RECOMMENDED_MARKER = '.localix/mini-app-recommended.json'

interface Marker {
  offered: string[]
}

async function readMarker(path: string): Promise<Marker | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(path, 'utf8'))
    return Array.isArray(parsed?.offered)
      ? { offered: parsed.offered.filter((n: unknown) => typeof n === 'string') }
      : null
  } catch {
    return null
  }
}

async function writeMarker(path: string, marker: Marker): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const pending = `${path}.${process.pid}.tmp`
  await fs.writeFile(
    pending,
    `${JSON.stringify({ offered: [...marker.offered].sort() }, null, 2)}\n`,
  )
  await fs.rename(pending, path)
}

export function createRecommendedInstalls(deps: {
  store: Pick<MiniAppStore, 'list' | 'install' | 'settled' | 'jobs'>
  homeDir: string
  /** Whose yes the install records: the installation's own user. */
  userId: string
  log?: (event: string, detail: Record<string, unknown>) => void
}) {
  const markerPath = join(deps.homeDir, RECOMMENDED_MARKER)
  return {
    /** One pass: `done` when nothing is left to offer now, `retry` when something must wait. */
    async run(): Promise<'done' | 'retry'> {
      const marker = await readMarker(markerPath)
      const { entries, problems } = await deps.store.list()
      const recommended = entries.filter((entry) => entry.installByDefault && !entry.incompatible)
      if (recommended.length === 0) return problems.length > 0 ? 'retry' : 'done'

      const offered = new Set(marker?.offered ?? [])
      if (!marker && entries.some((entry) => entry.installed)) {
        // Not a new installation: what it has is the person's choice.
        await writeMarker(markerPath, { offered: recommended.map((entry) => entry.id) })
        return 'done'
      }
      const queued: { id: string; name: string }[] = []
      for (const entry of recommended) {
        if (offered.has(entry.id)) continue
        if (entry.installed) {
          offered.add(entry.id)
          continue
        }
        try {
          await deps.store.install(entry.id, { userId: deps.userId })
          queued.push(entry)
        } catch (error) {
          // Refused before anything was downloaded (another app holds the name here): it was
          // offered, and the name is taken.
          deps.log?.('mini_apps.recommended_refused', {
            id: entry.id,
            error: errorMessage(error),
          })
          offered.add(entry.id)
        }
      }
      await deps.store.settled()
      let failed = false
      for (const { id, name } of queued) {
        if (deps.store.jobs().get(name)?.phase === 'done') offered.add(id)
        else failed = true
      }
      await writeMarker(markerPath, { offered: [...offered] })
      return failed ? 'retry' : 'done'
    },
  }
}
