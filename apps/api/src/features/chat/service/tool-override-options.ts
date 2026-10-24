import { substituteToolPathVars, type ToolPathVars } from '../../agent-core/skill-tool-path-vars'

export {
  skillToolPathVars,
  substituteToolPathVars,
  type ToolPathVars,
} from '../../agent-core/skill-tool-path-vars'

/**
 * Build the macro tool-override options from a command/skill's `allowedTools` /
 * `disallowedTools` lists — allowed tools are auto-approved, disallowed ones
 * removed. Returns undefined when neither is set so the macro runs the default
 * toolkit. Shared by the plugin-command and skill-command dispatchers.
 *
 * The `${CLAUDE_*}` path variables a skill's body gets are filled into each token first —
 * Claude Code substitutes `${CLAUDE_SKILL_DIR}` and `${CLAUDE_PROJECT_DIR}` (and, for a plugin,
 * `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}`) in `allowed-tools` too, so a rule such as
 * `Bash(${CLAUDE_SKILL_DIR}/scripts/render.sh *)` matches the command the body tells the model
 * to run. A bare string is the project dir, the form older callers pass.
 *
 * Dependency-free (pure string work) so it stays unit-testable without pulling in
 * the chat-service graph.
 */
export function toolOverrideOptions(
  src: {
    allowedTools?: string[]
    disallowedTools?: string[]
  },
  vars?: string | ToolPathVars,
): { extraAllowedTools?: string[]; extraDisabledTools?: string[] } | undefined {
  if (!src.allowedTools?.length && !src.disallowedTools?.length) return undefined
  const pathVars: ToolPathVars =
    typeof vars === 'string' ? { CLAUDE_PROJECT_DIR: vars } : (vars ?? {})
  return {
    extraAllowedTools: substituteToolPathVars(src.allowedTools, pathVars),
    extraDisabledTools: substituteToolPathVars(src.disallowedTools, pathVars),
  }
}
