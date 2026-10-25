import { isPathWithin } from '../lib/path-containment'
import { claudeCodeHome } from '../features/cc-settings/config-dir'
import type { ManagedSettingsSource } from '../features/cc-settings/managed-settings'
import { skillShellExecutionDisabled } from '../features/cc-settings/settings-policy'
import { builtinPluginsRoot } from '../features/plugins/builtin-plugins'
import type { SkillShellPolicy } from '../features/chat/service/skill-render'

interface Options {
  /** Where Claude Code's user settings live. */
  homeDir?: string
  /** The managed source; the machine's own by default. */
  managed?: ManagedSettingsSource | null
  /** Where the built-in plugins live; the shipped ones by default. */
  builtinRoot?: () => string | null
}

/**
 * `disableSkillShellExecution`, wired for chat (A4: chat reads no settings itself, the composition
 * root hands it this port). The setting is read for the session's working directory on each render,
 * so an edit applies to the next skill without a restart. Claude Code leaves "bundled and managed
 * skills" alone: Localix's built-in plugins are the bundled ones, so a skill or command under the
 * built-in plugins folder keeps running its commands.
 */
export function createSkillShellPolicy(options: Options = {}): SkillShellPolicy {
  const homeDir = options.homeDir ?? claudeCodeHome()
  const builtinRoot = options.builtinRoot ?? builtinPluginsRoot
  return async ({ workingDir, skillPath }) => {
    const root = builtinRoot()
    if (skillPath && root && isPathWithin(root, skillPath)) return false
    return skillShellExecutionDisabled({
      homeDir,
      cwd: workingDir,
      ...(options.managed !== undefined ? { managed: options.managed } : {}),
    })
  }
}
