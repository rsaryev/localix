import type { SkillUsageRepository, SkillScope } from './repository'
import type { CuratorReport, CuratorSkillRecord } from './contracts'

export interface SkillsCuratorServiceDeps {
  usageRepo: SkillUsageRepository
  /** Resolves a project's working dir for project-scoped skills (REST passes projectId). */
  resolveProjectCwd?: (userId: string, projectId: string) => Promise<string | null>
  /** Base dir for global skills (`<globalBase>/.claude/skills`). Defaults to the home dir. */
  globalBase?: string
  /** Where archived skills wait, outside `.claude/skills`. Defaults to `~/.localix/skills-archive`. */
  archiveRoot?: string
  /** Marker file for the scheduled-run cadence. Defaults to `~/.localix/curator-state.json`. */
  stateFile?: string
  now?: () => Date
  logger?: { info?: (msg: string) => void; warn?: (msg: string) => void }
  /** A skill moved or was pinned: the capability set changed (bootstrap bumps the revision). */
  capabilitiesChanged?: () => void
  /** A scheduled pass archived these skills (names): the person is told, with a way back. */
  onArchived?: (userId: string, names: string[]) => void
}

export interface SkillsCuratorService {
  listSkills(userId: string, opts?: { projectId?: string | null }): Promise<CuratorSkillRecord[]>
  setPinned(
    userId: string,
    input: {
      name: string
      scope: SkillScope
      pinned: boolean
      projectId?: string | null
    },
  ): Promise<CuratorSkillRecord>
  archive(
    userId: string,
    input: { name: string; projectId?: string | null },
  ): Promise<CuratorSkillRecord>
  restore(
    userId: string,
    input: { name: string; projectId?: string | null },
  ): Promise<CuratorSkillRecord>
  /**
   * Archive the named skills that are still stale: one pinned or used since a preview is left
   * alone. Answers what was archived.
   */
  archiveUnused(
    userId: string,
    input: { names: string[]; projectId?: string | null },
  ): Promise<CuratorSkillRecord[]>
  /** One deterministic pass: archive stale, unpinned filesystem skills. */
  runCurator(userId: string, opts?: { projectId?: string | null }): Promise<CuratorReport>
  /**
   * Cadence-guarded scheduled entry point (startup + periodic timer). First
   * observation only seeds the marker (first-run defer); later
   * calls run a global pass at most once per {@link CURATOR_INTERVAL_DAYS}.
   * Returns the report when a pass actually ran, null otherwise.
   */
  maybeRunScheduled(userId: string): Promise<CuratorReport | null>
}
