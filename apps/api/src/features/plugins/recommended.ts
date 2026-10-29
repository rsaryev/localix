import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

import { DomainError } from '../../lib/domain-errors'
import { errorMessage } from '../../lib/errors'

/**
 * RECOMMENDED PLUGINS, installed on their own: the plugins Localix's marketplace names in its
 * `metadata.localix.recommended`, the twin of the mini apps' pass (`mini-apps/recommended.ts`).
 * They are Localix's own, so they install in the background without asking, whatever they run; a
 * marketplace someone added recommends nothing (`store-editorial.ts`). They go to Localix's plugin
 * folder (`~/.localix/plugins`), never Claude Code's.
 *
 * - **Once per plugin.** Every plugin it has offered is remembered in a marker under `~/.localix`,
 *   so one the person removes is never added again; one the marketplace recommends later is
 *   offered once too, on a new installation or an old one.
 * - **Installed already** counts as offered and is left as it is.
 * - **Offline is later.** A marketplace that cannot be read, or an install that fails on the way,
 *   leaves that plugin unmarked and answers `retry`; the caller runs the pass again
 *   (`bootstrap/plugin-update-timers.ts`). An install the plugins refuse (a dependency missing) is
 *   an answer, not an outage: that plugin counts as offered.
 */

export const RECOMMENDED_PLUGINS_MARKER = '.localix/plugin-recommended.json'

async function readOffered(path: string): Promise<Set<string>> {
  try {
    const parsed = JSON.parse(await fs.readFile(path, 'utf8'))
    return new Set(
      Array.isArray(parsed?.offered)
        ? parsed.offered.filter((id: unknown) => typeof id === 'string')
        : [],
    )
  } catch {
    return new Set()
  }
}

async function writeOffered(path: string, offered: Set<string>): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const pending = `${path}.${process.pid}.tmp`
  await fs.writeFile(pending, `${JSON.stringify({ offered: [...offered].sort() }, null, 2)}\n`)
  await fs.rename(pending, path)
}

export function createRecommendedPluginInstalls(deps: {
  homeDir: string
  /** What Localix's marketplace recommends, by `<plugin>@<marketplace>`; null while unread. */
  recommended(): Promise<{ id: string; installed: boolean }[] | null>
  /** Install one for the person and enable it; resolves when it is installed. */
  install(id: string): Promise<void>
  log?: (event: string, detail: Record<string, unknown>) => void
}) {
  const markerPath = join(deps.homeDir, RECOMMENDED_PLUGINS_MARKER)
  return {
    /** One pass: `done` when nothing is left to offer now, `retry` when something must wait. */
    async run(): Promise<'done' | 'retry'> {
      const recommended = await deps.recommended()
      if (!recommended) return 'retry'
      const offered = await readOffered(markerPath)
      let failed = false
      for (const plugin of recommended) {
        if (offered.has(plugin.id)) continue
        if (plugin.installed) {
          offered.add(plugin.id)
          continue
        }
        try {
          await deps.install(plugin.id)
          offered.add(plugin.id)
        } catch (error) {
          deps.log?.('plugins.recommended_install_failed', {
            id: plugin.id,
            error: errorMessage(error),
          })
          if (error instanceof DomainError) offered.add(plugin.id)
          else failed = true
        }
      }
      await writeOffered(markerPath, offered)
      return failed ? 'retry' : 'done'
    },
  }
}
