import type { SkillSourcePolicy } from '../features/agent-core/skill-source-policy'
import type { ManagedSettingsSource } from '../features/cc-settings/managed-settings'
import { readPluginOnlyLocks } from '../features/cc-settings/settings-policy'

/**
 * `strictPluginOnlyCustomization`, for skill folders (A4: the composition root reads Claude Code's
 * managed settings and hands the skill discovery this answer). `skills` locked closes the person's
 * and the project's skill and command folders; `hooks` locked takes the frontmatter hooks of what
 * still loads. Read on every discovery, so an edit of the managed file applies to the next run.
 */
export function createSkillSourcePolicy(
  options: { managed?: ManagedSettingsSource | null } = {},
): SkillSourcePolicy {
  return async ({ workingDir, homeDir }) => {
    const locks = await readPluginOnlyLocks({
      homeDir,
      cwd: workingDir,
      ...(options.managed !== undefined ? { managed: options.managed } : {}),
    })
    return { blockFolders: locks.has('skills'), stripHooks: locks.has('hooks') }
  }
}
