import type { SkillSourcePolicy } from '../features/agent-core/skill-source-policy'
import {
  customizationLocks,
  readClaudeSettings,
  type ManagedSettingsSource,
} from '../features/plugins/kit'

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
    const settings = await readClaudeSettings({
      homeDir,
      cwd: workingDir,
      ...(options.managed !== undefined ? { managed: options.managed } : {}),
    })
    const locks = customizationLocks(settings)
    return { blockFolders: locks.has('skills'), stripHooks: locks.has('hooks') }
  }
}
