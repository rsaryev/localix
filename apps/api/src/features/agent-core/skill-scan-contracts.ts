export type SkillScanScope = 'project' | 'global'

export interface SkillScanLogger {
  warn: (message: string, meta?: unknown) => void
}

/** Cap work per root so one pathological tree cannot fan out across the entire filesystem. */
export const MAX_SKILL_ENTRIES_PER_ROOT = 2000

/** Allow nested portable skill categories while preventing unbounded recursion. */
export const MAX_SKILL_SCAN_DEPTH = 6

/** Bound independent stats/reads so discovery does not exhaust the fs worker pool. */
export const MAX_CONCURRENT_SKILL_READS = 32
