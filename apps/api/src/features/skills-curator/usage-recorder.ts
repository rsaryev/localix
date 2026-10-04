/**
 * Process-wide skill-usage recorder. The skill tool (`runtime/tools/skill.ts`)
 * is constructed without DB access (just workingDir + extra skills), so usage
 * tracking is wired through this tiny singleton instead of threading new
 * options through the tool registry: bootstrap registers a sink that writes to
 * the `skill_usage` table, and the tool fire-and-forgets into it.
 *
 * Recording is best-effort by design — it must never fail or slow a skill
 * `get`. When no sink is registered (tests, ad-hoc tool use) it is a no-op.
 */

export type SkillUsageSink = (
  skillName: string,
  scope: 'project' | 'global',
  projectId: string,
) => void | Promise<void>

let sink: SkillUsageSink | null = null

export function setSkillUsageRecorder(next: SkillUsageSink | null): void {
  sink = next
}

/** Fire-and-forget usage tick. Swallows every error — telemetry must not break skills. */
export function recordSkillUse(
  skillName: string,
  scope: 'project' | 'global',
  projectId = '',
): void {
  if (!sink) return
  try {
    void Promise.resolve(sink(skillName, scope, projectId)).catch(() => {})
  } catch {
    // best-effort only
  }
}
