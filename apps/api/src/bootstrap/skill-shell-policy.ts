import { claudeCodeHome } from '../features/cc-settings/config-dir'
import type { ManagedSettingsSource } from '../features/cc-settings/managed-settings'
import { skillShellExecutionDisabled } from '../features/cc-settings/settings-policy'
import type { SkillShellPolicy } from '../features/chat/service/skill-render'

interface Options {
  /** Where Claude Code's user settings live. */
  homeDir?: string
  /** The managed source; the machine's own by default. */
  managed?: ManagedSettingsSource | null
}

/**
 * `disableSkillShellExecution`, wired for chat (A4: chat reads no settings itself, the composition
 * root hands it this port). The setting is read for the session's working directory on each render,
 * so an edit applies to the next skill without a restart. Claude Code leaves "bundled and managed
 * skills" alone; Localix ships no plugin, so every skill it runs is one the setting covers.
 */
export function createSkillShellPolicy(options: Options = {}): SkillShellPolicy {
  const homeDir = options.homeDir ?? claudeCodeHome()
  return async ({ workingDir }) =>
    skillShellExecutionDisabled({
      homeDir,
      cwd: workingDir,
      ...(options.managed !== undefined ? { managed: options.managed } : {}),
    })
}
