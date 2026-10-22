import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../db'
import { listSubdirs, pathExists } from '../ext/fs-discovery'
import { defaultProjectDir, normalizeProjectDir } from '../projects/default-project'

/**
 * One-time, idempotent startup migration of plugin installs made into the Default project's
 * folder (`~/.localix/workspace/.localix/plugins`), which were invisible to its chats (they run in
 * per-chat sandboxes). They move to the global root and their `capability_source` rows move to the
 * global scope. A name that already exists globally is left where it is and logged.
 *
 * Claude Code-layout installs need nothing: they load in place (`layout/compose.ts`), and the root
 * `plugin.json` an earlier version wrote beside one is ignored.
 */

interface MigrationLogger {
  info: (fields: object, msg?: string) => void
  warn: (fields: object, msg?: string) => void
}

export interface LegacyMigrationInput {
  db: Kysely<AppDatabase>
  homeDir: string
  logger: MigrationLogger
  /** The Default project's directory; tests pass a fixture. */
  defaultProjectDir?: string
}

const PLUGINS = join('.localix', 'plugins')

async function relocateDefaultProjectInstalls(input: LegacyMigrationInput): Promise<void> {
  const defaultDir = input.defaultProjectDir ?? defaultProjectDir()
  const from = join(defaultDir, PLUGINS)
  const names = await listSubdirs(from)
  if (!names.length) return
  const to = join(input.homeDir, PLUGINS)
  await fs.mkdir(to, { recursive: true })
  const projects = await input.db.selectFrom('projects').select(['id', 'working_dir']).execute()
  const defaultIds = projects
    .filter((p) => normalizeProjectDir(p.working_dir) === normalizeProjectDir(defaultDir))
    .map((p) => p.id)
  for (const name of names) {
    const target = join(to, name)
    if (await pathExists(target)) {
      input.logger.warn(
        { event: 'plugin.migrate.skip', name, from: join(from, name) },
        'A global plugin with this name exists; the Default-project copy was left in place',
      )
      continue
    }
    await fs.rename(join(from, name), target)
    if (defaultIds.length) {
      const rows = await input.db
        .selectFrom('capability_source')
        .select(['id', 'user_id'])
        .where('kind', '=', 'plugin')
        .where('name', '=', name)
        .where('project_id', 'in', defaultIds)
        .execute()
      for (const row of rows) {
        const clash = await input.db
          .selectFrom('capability_source')
          .select('id')
          .where('kind', '=', 'plugin')
          .where('name', '=', name)
          .where('user_id', '=', row.user_id)
          .where('project_id', '=', '')
          .executeTakeFirst()
        if (clash) continue
        await input.db
          .updateTable('capability_source')
          .set({ project_id: '' })
          .where('id', '=', row.id)
          .execute()
      }
    }
    input.logger.info(
      { event: 'plugin.migrate.relocate', name, to: target },
      'Moved a Default-project plugin to the global plugin root',
    )
  }
}

/** Run the migration. Never throws: a failure is logged and startup continues. */
export async function migrateLegacyPluginInstalls(input: LegacyMigrationInput): Promise<void> {
  try {
    await relocateDefaultProjectInstalls(input)
  } catch (error) {
    input.logger.warn(
      { event: 'plugin.migrate.failed', error: String(error) },
      'Legacy plugin install migration failed',
    )
  }
}
