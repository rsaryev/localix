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
export const pluginCommandArgConditionSchema = z.object({ arg: z.string(), equals: z.string() })

export const pluginCommandArgSchema = z.object({
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
  when: pluginCommandArgConditionSchema.optional(),
})
export type PluginCommandArg = z.infer<typeof pluginCommandArgSchema>

/**
 * An inline slash-command a plugin declares in its manifest. `prompt` is an
 * agent-macro template with `${argName}` placeholders filled from the parsed args;
 * the rendered prompt is dispatched generically by the backend (no per-plugin code).
 */
export const pluginCommandSchema = z.object({
  // Accepts a namespaced `foo:bar` name (nested `commands/foo/bar.md`), of which a plain
  // single-segment name is the common case (PLUGIN_QUALIFIED_NAME_RE ⊇ PLUGIN_NAME_RE).
  name: z.string().regex(PLUGIN_QUALIFIED_NAME_RE),
  description: z.string().default(''),
  args: z.array(pluginCommandArgSchema).default([]),
  prompt: z.string(), // agent-macro template; ${argName} placeholders
  /**
   * CC `arguments` — names for the positional arguments, filling `$name` in the prompt
   * (`arguments: [env, branch]` → `$env` is the first word, `$branch` the second).
   */
  arguments: z.array(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_-]*$/)).optional(),
  /** CC `argumentHint` — placeholder shown in the composer when this command is selected. */
  argumentHint: z.string().optional(),
  /** Shown first in the slash menu, under "Suggested". */
  featured: z.boolean().optional(),
  /**
   * Deferred tools the command's work needs for the rest of the chat, activated when it runs, as
   * if the agent had called `activate_tools` (e.g. a board tool for a command that plans on it).
   */
  activateTools: z.array(z.string().min(1)).max(8).optional(),
  /**
   * CC `model` — preferred model alias/id for this command's macro run (e.g. "opus",
   * a full catalog id). Best-effort: applied as a per-run session model override; the
   * id must be valid for a configured provider (an unknown id fails that run, same as CC).
   */
  model: z.string().optional(),
  /**
   * CC `disable-model-invocation` — user-invocable only, excluded from any model-facing
   * command listing. Plugin commands are not exposed to the model in this host, so today
   * this is honored trivially; the flag is carried for forward-compatibility + tooling.
   */
  disableModelInvocation: z.boolean().optional(),
  /**
   * CC `allowedTools` — tools auto-approved during this command's run (same as skill frontmatter).
   * Comma/space/YAML-inline-array format; CC tool names are normalized to engine names.
   */
  allowedTools: z.array(z.string()).optional(),
  /**
   * CC `disallowedTools` — tools removed from the pool during this command's run.
   * Comma/space/YAML-inline-array format; CC tool names are normalized to engine names.
   */
  disallowedTools: z.array(z.string()).optional(),
})
export type PluginCommand = z.infer<typeof pluginCommandSchema>

/** What a mini app may set on one of its plugin's commands (`commandOptions`). */
export const pluginCommandOptionsSchema = pluginCommandSchema
  .pick({ args: true, featured: true, activateTools: true })
  .partial()

/**
 * UI-facing per-command spec returned by the commands endpoint. The `prompt`
 * template stays server-side (rendered during dispatch); the UI only needs enough
 * to render the composer menu entry + arg chips. `fullName` is the namespaced
 * `<plugin>:<name>` the user types.
 */
/**
 * UI-facing arg spec. Derived from `pluginCommandArgSchema` but the script PATH is
 * never sent to the client — it's collapsed to a `dynamic` boolean (the composer only
 * needs to know it must fetch options on demand, not where from).
 */
export const pluginCommandArgSpecSchema = z.object({
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
  when: pluginCommandArgConditionSchema.optional(),
})

export const pluginCommandSpecSchema = z.object({
  pluginName: z.string(),
  name: z.string(), // bare command name
  fullName: z.string(), // namespaced "<plugin>:<name>"
  description: z.string(),
  args: z.array(pluginCommandArgSpecSchema),
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
