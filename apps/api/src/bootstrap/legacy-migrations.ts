import { join } from 'node:path'
import { migrateLegacyPluginInstalls } from '../features/plugins/legacy-install-migration'
import { migrateLegacySkills } from '../features/skills-curator/legacy-skills-migration'
import { createSkillUsageRepository } from '../features/skills-curator/repository'
import { defaultArchiveRoot } from '../features/skills-curator/skill-fs'
import { localixHome, userHome } from '../lib/env'
import type { InfraPhase } from './infra'

/** The one-time conversions of what earlier builds left on disk, run before any discovery. */
export async function runLegacyMigrations({
  db,
  env,
  logger,
}: Pick<InfraPhase, 'db' | 'env' | 'logger'>): Promise<void> {
  // Before any discovery: convert pre-native plugin installs once (idempotent, logged).
  await migrateLegacyPluginInstalls({ db, homeDir: userHome(), logger })
  // Once: the skills Localix kept in `.localix/skills` move to Claude Code's `.claude/skills`.
  await migrateLegacySkills({
    userId: env.LOCALIX_DEFAULT_USER_ID,
    homeDir: userHome(),
    archiveRoot: defaultArchiveRoot(),
    markerFile: join(localixHome(), 'skills-claude-layout.json'),
    projects: async () =>
      (
        await db
          .selectFrom('projects')
          .select(['id', 'working_dir'])
          .where('deleted_at', 'is', null)
          .execute()
      ).map((p) => ({ id: p.id, workingDir: p.working_dir })),
    usage: createSkillUsageRepository(db),
    logger,
  }).catch((error) => logger.warn({ event: 'skills.migrate.error', error: String(error) }))
}
