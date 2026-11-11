import { z } from 'zod'
import { PLUGIN_QUALIFIED_NAME_RE } from './contracts-base'

/**
 * A single argument a plugin slash-command declares. Mirrors the UI `SlashArgSpec`:
 * a `text` arg captures free-form input; a `choice` arg is validated against its
 * `options`. Args are positional and substituted into the command `prompt` as
 * `${name}` placeholders.
 */
/** Gate an arg on an earlier choice chip (mirrors the shared `ArgCondition`): the arg
 *  is only offered once the chip named `arg` was committed with value `equals`. */
export const miniAppCommandArgConditionSchema = z.object({ arg: z.string(), equals: z.string() })

export const miniAppCommandArgSchema = z.object({
  /** Arg name — must be a valid `${name}` placeholder (letters, digits, underscores, hyphens). */
  name: z
    .string()
    .regex(
      /^[a-zA-Z_][a-zA-Z0-9_-]*$/,
      'Arg name must start with a letter/underscore and contain only letters, digits, underscores, or hyphens',
    ),
  type: z.enum(['text', 'choice']).default('text'),
  description: z.string().default(''),
  placeholder: z.string().optional(),
  required: z.boolean().default(false),
  options: z
    .array(
      z.object({
        value: z.string(),
        label: z.string().optional(),
        description: z.string().optional(),
      }),
    )
    .optional(),
  /**
   * DYNAMIC options: a plugin-relative path to a JS/TS script (run by `bun`) that
   * prints an `ArgOption[]` JSON to stdout for this arg's picker. Mutually exclusive
   * with static `options`; only meaningful on a `choice` arg. The core runs it in the
   * session cwd, feeding a JSON request on stdin (`{query,cwd,sessionId,argName,command,config}`);
   * see `arg-options.ts`. The path is confined to the plugin dir + enable/shell-policy gated.
   */
  optionsScript: z.string().optional(),
  /** Show this arg only after an earlier choice chip took a given value. */
  when: miniAppCommandArgConditionSchema.optional(),
})
export type MiniAppCommandArg = z.infer<typeof miniAppCommandArgSchema>

/**
 * A plugin's command as the catalog lists it: what the composer's menu, the store's contents and
 * the validator read. It runs as the skill it is in the chat's kit session
 * (`command-handlers-plugin-command.ts`), which reads the command file itself.
 */
export const pluginCommandSchema = z.object({
  // Accepts a namespaced `foo:bar` name (nested `commands/foo/bar.md`), of which a plain
  // single-segment name is the common case.
  name: z.string().regex(PLUGIN_QUALIFIED_NAME_RE),
  description: z.string().default(''),
  /** The command's text as written: the validator warns when it is empty. */
  prompt: z.string(),
  /** CC `argument-hint` — placeholder shown in the composer when this command is selected. */
  argumentHint: z.string().optional(),
  /** CC `allowed-tools`, checked by the validator against the engine's tools. */
  allowedTools: z.array(z.string()).optional(),
  /** CC `disallowed-tools`, checked by the validator against the engine's tools. */
  disallowedTools: z.array(z.string()).optional(),
})
export type PluginCommand = z.infer<typeof pluginCommandSchema>

/**
 * UI-facing per-command spec returned by the commands endpoint. The `prompt`
 * template stays server-side (rendered during dispatch); the UI only needs enough
 * to render the composer menu entry + arg chips. `fullName` is the namespaced
 * `<plugin>:<name>` the user types.
 */
/**
 * UI-facing arg spec. Derived from `miniAppCommandArgSchema` but the script PATH is
 * never sent to the client — it's collapsed to a `dynamic` boolean (the composer only
 * needs to know it must fetch options on demand, not where from).
 */
export const miniAppCommandArgSpecSchema = z.object({
  name: z.string(),
  type: z.enum(['text', 'choice']),
  description: z.string().default(''),
  placeholder: z.string().optional(),
  required: z.boolean().default(false),
  options: z
    .array(
      z.object({
        value: z.string(),
        label: z.string().optional(),
        description: z.string().optional(),
      }),
    )
    .optional(),
  /** True when this arg's options load on demand from the plugin (via `optionsScript`). */
  dynamic: z.boolean().optional(),
  when: miniAppCommandArgConditionSchema.optional(),
})

export const pluginCommandSpecSchema = z.object({
  pluginName: z.string(),
  name: z.string(), // bare command name
  fullName: z.string(), // namespaced "<plugin>:<name>"
  description: z.string(),
  args: z.array(miniAppCommandArgSpecSchema),
  /** Composer placeholder hint (CC compat: `argument-hint` in command frontmatter). */
  argumentHint: z.string().optional(),
  /** Shown first in the slash menu, under "Suggested". */
  featured: z.boolean().optional(),
})
export type PluginCommandSpec = z.infer<typeof pluginCommandSpecSchema>

export const listPluginCommandsResponseSchema = z.object({
  commands: z.array(pluginCommandSpecSchema),
})
export type ListPluginCommandsResponse = z.infer<typeof listPluginCommandsResponseSchema>
