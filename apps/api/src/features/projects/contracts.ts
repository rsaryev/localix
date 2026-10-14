import {
  PROJECT_CUSTOM_SYSTEM_PROMPT_MAX_CHARS,
  PROJECT_SETTINGS_MAX_SERIALIZED_CHARS,
} from './limits'
import { z } from 'zod'
import { SNIPPET_CONTENT_MAX } from '../chat/context-ref-kinds'
import { contextExclusionsSchema } from '../context-fabric/exclusion-schema'
import { modelIdSchema, providerConnectionIdSchema } from '../catalog/model-identity'

export {
  PROJECT_CUSTOM_SYSTEM_PROMPT_MAX_CHARS,
  PROJECT_SETTINGS_MAX_SERIALIZED_CHARS,
} from './limits'

function isProjectSettingsWithinIngressBudget(value: unknown): boolean {
  try {
    return JSON.stringify(value).length <= PROJECT_SETTINGS_MAX_SERIALIZED_CHARS
  } catch {
    return false
  }
}

/**
 * A permission rule: allow / deny / ask for a tool-and-target pattern.
 * `permission` matches a tool name, a capability token ("mutates"), or "*".
 * `pattern` is "*", a reserved keyword ("outside-workspace", "dangerous"), or a
 *   literal substring matched against the call's target path(s)/command.
 * `action` is "allow" | "deny" | "ask".
 * `message` (optional) is shown to the agent on deny, or used as the confirm prompt on ask.
 */
export const permissionRuleSchema = z.object({
  permission: z.string(),
  pattern: z.string().default('*'),
  action: z.enum(['allow', 'deny', 'ask']),
  message: z.string().optional(),
  /** The person-facing refusal of a built-in rule (`capabilities/rule.ts` `personMessage`). */
  personMessage: z.string().optional(),
})

export const projectSettingsSchema = z.object({
  /** Settings-envelope revision. Absent values are legacy version 0. */
  schemaVersion: z.literal(1).optional(),
  customSystemPrompt: z.string().optional(),
  modelId: modelIdSchema.optional(),
  providerConnectionId: providerConnectionIdSchema.optional(),
  /** Per-project override for the amber tool-budget threshold. See the user setting. */
  toolBudgetWarn: z.number().int().positive().optional(),
  /** Project-local Context Fabric exclusions; merged with user exclusions and can
   * only tighten the mandatory ContextPolicy denylist. */
  contextExclusions: contextExclusionsSchema.optional(),
})

/**
 * Atomic top-level project-settings patch. `null` deletes a field; omitted fields
 * are preserved. This avoids the lost-update class caused by clients round-tripping
 * an older copy of the complete settings object.
 */
export const projectSettingsPatchSchema = z
  .object({
    schemaVersion: z.literal(1).nullable().optional(),
    customSystemPrompt: z
      .string()
      .max(PROJECT_CUSTOM_SYSTEM_PROMPT_MAX_CHARS)
      .nullable()
      .optional(),
    modelId: modelIdSchema.nullable().optional(),
    providerConnectionId: providerConnectionIdSchema.nullable().optional(),
    contextExclusions: contextExclusionsSchema.nullable().optional(),
  })
  .strict()
  .refine(isProjectSettingsWithinIngressBudget, {
    message: `Project settings patch must serialize to at most ${PROJECT_SETTINGS_MAX_SERIALIZED_CHARS} characters`,
  })

export type PermissionRule = z.infer<typeof permissionRuleSchema>

/** Globally unique project reference / canonical id, e.g. `PRJ-3` — short and
 *  token-cheap vs a UUID (mirrors sessions' `LOCALIX-<seq>`). */
export function projectRef(seq: number): string {
  return `PRJ-${seq}`
}

export const projectSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  workingDir: z.string(),
  settings: projectSettingsSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /**
   * This is the project an unassigned session lands in (`projects/default-project.ts`).
   *
   * On the wire because the WORKSPACE now has no project-less scope: the client's neutral
   * home is a route to a real project, and it must be able to name which one without
   * re-deriving `~/.localix/workspace` in the browser. Identity is the DIRECTORY, so a
   * renamed "Default" still reports true.
   */
  isDefault: z.boolean(),
})

export const createProjectRequestSchema = z.object({
  name: z.string().min(1),
  workingDir: z.string().min(1),
})

/**
 * Find-or-create a project by filesystem path — the `localix .` / `localix <dir>`
 * CLI entry point. Given an absolute directory, returns the matching project (by
 * workingDir) or mints a new one named after the directory's basename.
 */
export const resolveProjectByPathRequestSchema = z.object({
  path: z.string().min(1),
})

export const resolveProjectByPathResponseSchema = z.object({
  project: projectSchema,
  /** True when a new project was minted for this path, false when one existed. */
  created: z.boolean(),
  /**
   * Set when the input path is an existing FILE (not a directory): the project is
   * resolved from the file's parent dir and this is the absolute file to open in a
   * lightweight editor tab. Null for a directory input.
   */
  filePath: z.string().nullable(),
})

export const updateProjectRequestSchema = z
  .object({
    name: z.string().min(1).optional(),
    workingDir: z.string().min(1).optional(),
    settings: projectSettingsSchema
      .refine(
        (settings) =>
          !settings.customSystemPrompt ||
          settings.customSystemPrompt.length <= PROJECT_CUSTOM_SYSTEM_PROMPT_MAX_CHARS,
        {
          message: `Custom system prompt must contain at most ${PROJECT_CUSTOM_SYSTEM_PROMPT_MAX_CHARS} characters`,
        },
      )
      .refine(isProjectSettingsWithinIngressBudget, {
        message: `Project settings must serialize to at most ${PROJECT_SETTINGS_MAX_SERIALIZED_CHARS} characters`,
      })
      .optional(),
    settingsPatch: projectSettingsPatchSchema.optional(),
  })
  .refine((value) => !(value.settings && value.settingsPatch), {
    message: 'settings and settingsPatch are mutually exclusive',
  })

export const projectParamsSchema = z.object({
  id: z.string().min(1),
})

/** Max inline content carried by a `snippet` ref (client-minted). Defined ONCE in
 *  the pure ref-kind contracts (`features/chat/context-ref-kind-contracts.ts`) so the mint
 *  path (`makeSnippetRef`) can clamp to it client-side; the schema below enforces
 *  it as a backstop. Re-exported here for wire-contract consumers. */
export { SNIPPET_CONTENT_MAX }

/**
 * Composer context references (`@file:` / `@folder:` / `@session:` / `@project:` / `@terminal:` /
 * `@call:` / `@resource:` / `message` / `snippet`). The ref-kind registry in
 * `features/chat/context-ref-kinds.ts` is the source of truth for the token grammar;
 * resource providers own their URI namespaces. The UI parses typed syntax and sends structured
 * refs here; the server resolves them against the working directory (project working
 * dir, or the session sandbox workspace for project-less sessions) and returns the
 * expanded content. Read-only, path-confined, sensitive paths and binary files
 * rejected.
 *
 * The `snippet` kind is STRUCTURED-ONLY (never parsed from prompt text): it is
 * drag/attach-added and carries its OWN inline `content`, so its "expansion" is a
 * verbatim echo — no id, no working dir. Any client surface (a SQL Output log, a
 * text selection, a result cell) can mint one.
 */
export const contextRefSchema = z.object({
  /** Raw token as typed, e.g. "@file:src/x.ts:10-25" — echoed back for matching.
   *  For a `snippet` (never typed) this is a synthetic `@snippet:<label>` id. */
  raw: z.string().min(1).max(2048),
  kind: z.enum([
    'file',
    'folder',
    'session',
    'project',
    'message',
    'terminal',
    'call',
    'resource',
    'snippet',
  ]),
  /** Relative (to working dir) or absolute path — file/folder kinds only. */
  path: z.string().optional(),
  /** Opaque resource URI (`localix://resource/<provider>/<id>/…`) — resource kind only. Resolved by the
   *  scheme's registered `ResourceRefProvider` (agent-core resource-refs) into a
   *  model-facing expansion (schema DDL, listing…); never carries credentials. */
  uri: z.string().max(2048).optional(),
  /** Linked chat-session id (e.g. `LOCALIX-42`) — session kind only. Expands to
   *  a compact digest (title/summary/recent turns), not a full transcript.
   *  ALSO carries the host session id for a `message` ref (paired with `messageId`). */
  sessionId: z.string().optional(),
  /** Linked project id — project kind only. Expands to a compact project digest
   *  (name, working dir, session roster), NEVER creds/secrets/remote git config. */
  projectId: z.string().optional(),
  /** Linked transcript-message id — message kind only (paired with `sessionId`).
   *  Expands to that message's role + capped text. Resolved fresh server-side, so a
   *  since-deleted message degrades gracefully to a "could not expand" note. */
  messageId: z.string().optional(),
  /** Live PTY terminal id (full UUID or a unique prefix) — terminal kind only.
   *  Expands to a compact digest (cwd, recent commands + exit codes, output tail). */
  terminalId: z.string().optional(),
  /** Tool-call id from the sending session's transcript (full id or a unique
   *  prefix) — call kind only. Expands to a digest of the call (input + bounded
   *  result excerpt, error line for failed calls). */
  toolCallId: z.string().optional(),
  /** 1-indexed inclusive line range — file kind only. */
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
  /** 1-indexed selection columns — structured snippet refs only. */
  startColumn: z.number().int().min(1).optional(),
  endColumn: z.number().int().min(1).optional(),
  /** Number of commits — git kind only (clamped server-side to 1–20). */
  count: z.number().int().min(1).optional(),
  /** Inline content — `snippet` kind only. Echoed verbatim by the expander (fenced
   *  with `language`); capped at {@link SNIPPET_CONTENT_MAX}. Carries no id/URI — the
   *  content IS the ref, so no server fetch and no working dir are involved. */
  content: z.string().max(SNIPPET_CONTENT_MAX).optional(),
  /** Human label — `snippet` kind only (e.g. "Output — mydb"); drives the chip/pill. */
  label: z.string().max(512).optional(),
  /** Fence-language hint — `snippet` kind only (e.g. `text`, `sql`, `json`). */
  language: z.string().max(64).optional(),
})

export const expandRefsRequestSchema = z.object({
  /** A composer with no session yet: resolves the working dir to the project's workingDir. */
  projectId: z.string().nullish(),
  /**
   * The SENDING chat session. When present it decides the working dir — the server checks the
   * caller owns it and applies the one session-cwd rule (project root, else the root session's
   * sandbox) — and it scopes `@call:` lookups to its own transcript. The client never names a
   * directory or a root id: a client-sent root used to become a sandbox path unchecked.
   */
  sessionId: z.string().nullish(),
  refs: z.array(contextRefSchema).min(1).max(20),
  /** Preflight mode: return a CHEAP size estimate per ref (for the chip label +
   *  budget gate) WITHOUT the full expansion — never fetches a provider/DB/exchange/
   *  git. The one authoritative full expansion is the SEND-time one (`sendMessage`).
   *  The composer's link-time preflight sets this; omitted/false = full expansion. */
  sizeOnly: z.boolean().optional(),
})

export const contextRefExpansionSchema = z.object({
  raw: z.string(),
  ok: z.boolean(),
  /** Expanded content (file lines, folder listing, linked resource or session digest). */
  content: z.string().optional(),
  /** Fence language hint for file refs (from extension). */
  language: z.string().optional(),
  /**
   * Where a snippet was cut from — `path:line:column-line:column` — for a selection taken in
   * the editor. Rendered in the block header, so the model can edit that exact span instead of
   * searching the workspace for text it was only shown by file name and line numbers.
   */
  location: z.string().optional(),
  /** Why expansion was refused (not found / sensitive / binary / outside dir…). */
  error: z.string().optional(),
  /** Content size in characters (0 when not ok). */
  chars: z.number(),
  truncated: z.boolean().optional(),
  /** `sizeOnly` estimates expensive expansions; the composer marks their size approximate. */
  estimated: z.boolean().optional(),
})

export const expandRefsResponseSchema = z.object({
  workingDir: z.string(),
  expansions: z.array(contextRefExpansionSchema),
})

export type ContextRef = z.infer<typeof contextRefSchema>
export type ExpandRefsRequest = z.infer<typeof expandRefsRequestSchema>
export type ContextRefExpansion = z.infer<typeof contextRefExpansionSchema>
export type ExpandRefsResponse = z.infer<typeof expandRefsResponseSchema>

export const listProjectsResponseSchema = z.object({
  projects: z.array(projectSchema),
})

export type Project = z.infer<typeof projectSchema>
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>
export type ResolveProjectByPathRequest = z.infer<typeof resolveProjectByPathRequestSchema>
export type ResolveProjectByPathResponse = z.infer<typeof resolveProjectByPathResponseSchema>
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>
export type ProjectSettings = z.infer<typeof projectSettingsSchema>
export type ProjectSettingsPatch = z.infer<typeof projectSettingsPatchSchema>

/** Validate stored project settings instead of trusting the result of JSON.parse. */
export function normalizeProjectSettings(value: unknown): ProjectSettings | null {
  const parsed = projectSettingsSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
