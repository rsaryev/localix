/**
 * A Claude Code background monitor (experimental) as the kit read it: a long-running command whose
 * every stdout line reaches the model as a notification. `command` runs in the session cwd
 * (unsandboxed, hook trust level) with `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}` /
 * `${CLAUDE_PROJECT_DIR}`; `description` is shown in the task panel.
 */
export interface PluginMonitor {
  name: string
  command: string
  description: string
  /** `always`, or `on-skill-invoke:<skill>`: started the first time that skill runs in a chat. */
  when: 'always' | `on-skill-invoke:${string}`
}

/** True for a monitor that should spawn immediately (vs `on-skill-invoke:` lazy start). */
export function isAlwaysMonitor(m: PluginMonitor): boolean {
  return m.when === 'always'
}

/** The skill name a `on-skill-invoke:<skill>` monitor waits for, or null for `always`. */
export function monitorSkillTrigger(m: PluginMonitor): string | null {
  return m.when.startsWith('on-skill-invoke:') ? m.when.slice('on-skill-invoke:'.length) : null
}
