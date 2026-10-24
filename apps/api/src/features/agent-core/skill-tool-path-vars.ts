import { dirname } from 'node:path'

/**
 * The `${CLAUDE_*}` path variables a skill or command gets in its `allowed-tools`, as in its body:
 * Claude Code substitutes `${CLAUDE_SKILL_DIR}` and `${CLAUDE_PROJECT_DIR}` there, and for a plugin
 * `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}`, so `Bash(${CLAUDE_SKILL_DIR}/scripts/x.sh *)`
 * matches the command the body tells the model to run. Pure string work.
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
