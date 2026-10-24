import { z } from 'zod'

import { PLUGIN_NAME_RE, schemaIssue } from './contracts-base'

/**
 * Claude Code background `monitors` (experimental) — long-running commands whose
 * every stdout line is surfaced to the model as a notification. Declared inline
 * (top-level `monitors` / `experimental.monitors`) or in `monitors/monitors.json`.
 * See the CC plugins reference (Monitors section).
 *
 * Split from the manifest barrel so the runtime host + validation import the schema
 * without pulling the whole `contracts` cluster.
 */

/** Hard cap on monitors per plugin — a runaway manifest can't spawn unbounded processes. */
export const MONITORS_MAX_PER_PLUGIN = 16

/** `when` accepts the literal `"always"` or the `on-skill-invoke:<skill>` form. */
const monitorWhenSchema = z
  .string()
  .refine((v) => v === 'always' || /^on-skill-invoke:.+/.test(v), {
    message: 'monitor "when" must be "always" or "on-skill-invoke:<skill>"',
  })
  .default('always')

/**
 * One monitor entry. `command` runs in the session cwd (unsandboxed, hook trust
 * level) and supports `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}` /
 * `${CLAUDE_PROJECT_DIR}`. `description` is shown in the task panel.
 */
/** Strict, as in Claude Code: an unknown key is an error and the plugin doesn't load. */
export const pluginMonitorSchema = z.strictObject({
  name: z
    .string()
    .regex(PLUGIN_NAME_RE, 'Monitor name must be letters, numbers, dashes or underscores.'),
  command: z.string().min(1, 'Monitor command must be non-empty.'),
  description: z.string().default(''),
  when: monitorWhenSchema,
})
export type PluginMonitor = z.infer<typeof pluginMonitorSchema>

/** True for a monitor that should spawn immediately (vs `on-skill-invoke:` lazy start). */
export function isAlwaysMonitor(m: PluginMonitor): boolean {
  return m.when === 'always'
}

/** The skill name a `on-skill-invoke:<skill>` monitor waits for, or null for `always`. */
export function monitorSkillTrigger(m: PluginMonitor): string | null {
  return m.when.startsWith('on-skill-invoke:') ? m.when.slice('on-skill-invoke:'.length) : null
}

/**
 * Validate a raw monitors source (a bare array, or a `{ monitors: [...] }` file
 * wrapper) into typed, de-duplicated entries. Invalid entries and duplicate names
 * are dropped and reported in `errors` (never throws) — mirrors the loader's
 * per-artifact "a bad source contributes nothing" isolation.
 */
export function parseMonitors(raw: unknown): { monitors: PluginMonitor[]; errors: string[] } {
  const errors: string[] = []
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { monitors?: unknown }).monitors)
      ? (raw as { monitors: unknown[] }).monitors
      : []

  const monitors: PluginMonitor[] = []
  const seen = new Set<string>()
  for (const entry of list) {
    const parsed = pluginMonitorSchema.safeParse(entry)
    if (!parsed.success) {
      errors.push(`invalid monitor: ${schemaIssue(parsed.error)}`)
      continue
    }
    if (seen.has(parsed.data.name)) {
      errors.push(`duplicate monitor name "${parsed.data.name}" — later definition ignored`)
      continue
    }
    if (monitors.length >= MONITORS_MAX_PER_PLUGIN) {
      errors.push(
        `too many monitors (max ${MONITORS_MAX_PER_PLUGIN}) — "${parsed.data.name}" ignored`,
      )
      continue
    }
    seen.add(parsed.data.name)
    monitors.push(parsed.data)
  }
  return { monitors, errors }
}
