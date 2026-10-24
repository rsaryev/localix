import { dirname } from 'node:path'

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
export type ToolPathVars = Partial<
  Record<
    'CLAUDE_PROJECT_DIR' | 'CLAUDE_SKILL_DIR' | 'CLAUDE_PLUGIN_ROOT' | 'CLAUDE_PLUGIN_DATA',
    string
  >
>

/** The path variables of one skill or command, from where its file and plugin live. */
export function skillToolPathVars(input: {
  projectDir?: string
  /** The skill's `SKILL.md` (its folder is `${CLAUDE_SKILL_DIR}`). */
  path?: string
  pluginRoot?: string
  pluginDataDir?: string
}): ToolPathVars {
  return {
    ...(input.projectDir ? { CLAUDE_PROJECT_DIR: input.projectDir } : {}),
    ...(input.path ? { CLAUDE_SKILL_DIR: dirname(input.path) } : {}),
    ...(input.pluginRoot ? { CLAUDE_PLUGIN_ROOT: input.pluginRoot } : {}),
    ...(input.pluginDataDir ? { CLAUDE_PLUGIN_DATA: input.pluginDataDir } : {}),
  }
}

/** Each `${CLAUDE_*}` path variable in `vars` filled into every token. */
export function substituteToolPathVars(
  list: readonly string[] | undefined,
  vars: ToolPathVars,
): string[] | undefined {
  if (!list) return undefined
  const entries = Object.entries(vars).filter(([, value]) => value)
  return list.map((token) =>
    entries.reduce((out, [name, value]) => out.split(`\${${name}}`).join(value!), token),
  )
}

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
