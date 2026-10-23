import { z } from 'zod'

/**
 * The plugin feature's own primitives: Claude Code's name rule, its option types and how a schema
 * failure reads. Mini apps keep theirs in `@localixai/mini-app-sdk`; neither layer borrows the
 * other's (rule X1, `docs/internals/plugins-and-mini-apps.md`).
 */

/** A plugin name: letters, digits, `-` and `_`, starting with a letter or digit. */
export const PLUGIN_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i

/** A namespaced name, `<plugin>:<name>[:<name>…]`, as Claude Code addresses commands and agents. */
export const PLUGIN_QUALIFIED_NAME_RE = /^[a-z0-9][a-z0-9_-]*(?::[a-z0-9][a-z0-9_-]*)*$/i

/** The `userConfig` option types Claude Code defines. */
export const PLUGIN_CONFIG_TYPES = ['string', 'number', 'boolean', 'directory', 'file'] as const
export type PluginConfigType = (typeof PLUGIN_CONFIG_TYPES)[number]

/**
 * One `userConfig` option as the host keeps it (`sensitive` → `secret`, by `fromClaudePlugin`).
 * `multiple`, `title`, `min` and `max` are hints a host may render or enforce.
 */
export const pluginConfigOptionSchema = z.object({
  type: z.enum(PLUGIN_CONFIG_TYPES).default('string'),
  description: z.string().default(''),
  required: z.boolean().default(false),
  secret: z.boolean().default(false),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  title: z.string().optional(),
  multiple: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
})
export type PluginConfigOption = z.output<typeof pluginConfigOptionSchema>

/** A plugin's resolved option values, by key. */
export type PluginConfigValues = Record<string, string | number | boolean>

/** One line for a schema failure: the first issue, with where it is. */
export function schemaIssue(error: z.ZodError): string {
  const first = error.issues[0]
  if (!first) return 'invalid'
  const where = first.path.map(String).join('.')
  const more = error.issues.length > 1 ? ` (and ${error.issues.length - 1} more)` : ''
  return `${where ? `${where}: ` : ''}${first.message}${more}`
}
