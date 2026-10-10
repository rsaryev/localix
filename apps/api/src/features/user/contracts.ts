import { z } from 'zod'
import { MAX_MAX_TURNS } from '../chat/turn-budget'
import { contextExclusionsSchema } from '../context-fabric/exclusion-schema'
import { REASONING_EFFORTS } from '../../db/types'
import { isModelRoutingTaskKey } from '../chat/model-task-catalog'
import {
  AGENT_SETTINGS_MAX_SERIALIZED_CHARS,
  UI_SETTINGS_MAX_SERIALIZED_CHARS,
  isAgentSettingsWithinIngressBudget,
  isUiSettingsWithinIngressBudget,
} from './profile-limits'
import { modelIdSchema } from '../catalog/model-identity'
import { modelRoutingSchema } from './model-routing-schema'

type NullablePatchShape<T extends z.ZodRawShape> = {
  [K in keyof T]: z.ZodOptional<z.ZodNullable<T[K]>>
}

function nullablePatchShape<T extends z.ZodRawShape>(shape: T): NullablePatchShape<T> {
  return Object.fromEntries(
    Object.entries(shape).map(([key, schema]) => [
      key,
      (schema as z.ZodType).nullable().optional(),
    ]),
  ) as unknown as NullablePatchShape<T>
}

const uiSettingsShape = {
  /** Interface (sans) font. The mono values are legacy — kept for back-compat. */
  fontFamily: z
    .enum(['system', 'inter', 'geist', 'dm-sans', 'jetbrains-mono', 'fira-code'])
    .optional(),
  /** Editor / code (monospace) font — drives `--font-mono`. */
  codeFont: z.enum(['fragment-mono', 'jetbrains-mono', 'fira-code', 'system-mono']).optional(),
  fontSize: z.enum(['sm', 'md', 'lg', 'xl']).optional(),
  /** ISO timestamp set when the user finishes (or skips) the first-run onboarding wizard. Absent → wizard auto-shows. */
  onboardingCompletedAt: z.string().optional(),
  /**
   * Per-command keyboard-shortcut overrides. Keyed by the stable command id from
   * the UI keybindings catalog; the value is a platform-neutral canonical chord
   * string (e.g. "mod+shift+o", where "mod" = ⌘ on macOS / Ctrl elsewhere), or
   * `null` to explicitly unassign the command. Absent key → the catalog default.
   */
  keybindings: z.record(z.string(), z.string().nullable()).optional(),
  /**
   * The chosen base-keymap preset id ('default' | 'jetbrains' | 'sublime', open
   * set). Applying a preset writes its batch of
   * overrides into `keybindings` above and records the id here; a later
   * hand-edit leaves this stale, so the UI derives the displayed preset from the
   * actual `keybindings` map (falling back to "Custom"). Absent → 'default'.
   */
  keymapPreset: z.string().optional(),
}

export const uiSettingsSchema = z.object(uiSettingsShape)
/** Atomic top-level UI-settings patch; `null` deletes one field. */
export const uiSettingsPatchSchema = z
  .object(nullablePatchShape(uiSettingsShape))
  .strict()
  .refine(isUiSettingsWithinIngressBudget, {
    message: `UI settings patch must serialize to at most ${UI_SETTINGS_MAX_SERIALIZED_CHARS} characters`,
  })

const agentSettingsShape = {
  /** Settings-envelope revision for the current canonical schema. */
  schemaVersion: z.literal(1).optional(),
  /** User-wide Context Fabric exclusions, relative to each session workspace. */
  contextExclusions: contextExclusionsSchema.optional(),
  /**
   * Max agent turns (tool batches) per run before the loop hard-stops. Absent → a
   * high default (1000) that effectively never stops a productive run; lower it to
   * cap cost on autonomous tasks. The loop still ends naturally when the model stops
   * calling tools, and the no-progress guards stop a stuck loop regardless.
   */
  maxTurns: z.number().int().positive().optional(),
  /**
   * Tool count at which the composer's budget pill turns amber. Absent → 48, which leaves 11
   * tools of headroom above the 37 builtins that ship enabled so a clean install does not start
   * in the warning state. The hot threshold is derived from this setting with a 16-tool margin.
   *
   * A DISPLAY threshold only: nothing is disabled, denied or hidden at any count. See
   * `agent-core/tool-gc.ts`.
   */
  toolBudgetWarn: z.number().int().positive().optional(),
  /**
   * Canonical per-workload route. Availability, exact provider/model assignment,
   * and reasoning live together; switching a workload off preserves the rest of
   * its record. Missing assignment fields mean the catalog fallback.
   */
  modelRouting: modelRoutingSchema.optional(),
  /** Parameters remembered separately for every agent/provider/model, across chats. */
  agentModelSettings: z
    .array(
      z
        .object({
          agentId: z.string().min(1).max(200),
          providerId: z.string().min(1).max(200),
          modelId: modelIdSchema,
          effort: z.enum(REASONING_EFFORTS).optional(),
          maxTurns: z.number().int().min(1).max(MAX_MAX_TURNS).optional(),
        })
        .strict(),
    )
    .max(200)
    .superRefine((settings, ctx) => {
      const keys = new Set<string>()
      settings.forEach((entry, index) => {
        const key = JSON.stringify([entry.agentId, entry.providerId, entry.modelId])
        if (keys.has(key))
          ctx.addIssue({
            code: 'custom',
            path: [index],
            message: 'Agent/provider/model settings must be unique',
          })
        keys.add(key)
      })
    })
    .optional(),
  /**
   * Inline git blame — a dimmed line-end
   * annotation on the caret's line (author · relative date · commit summary) in the
   * code editor. Read-only, focused-line only, no aux model. On by default.
   */
  gitBlame: z.object({ enabled: z.boolean() }).optional(),
  /**
   * Scrollbar overview-ruler markers — coloured ticks on the editor's
   * vertical scroll track for diagnostics, git changes, and current search matches.
   * Passive visual aid, defaults ON (an unset config shows the markers).
   */
  editorScrollbarMarkers: z.object({ enabled: z.boolean() }).optional(),
  /**
   * Bracket-pair colorization ("rainbow brackets") — colour each
   * matching bracket pair `()[]{}` in the code editor by its nesting depth, cycling a
   * small theme-aware palette. Passive readability aid, defaults ON (an unset config
   * shows the colours). When off, brackets render plainly.
   */
  bracketPairColorization: z.object({ enabled: z.boolean() }).optional(),
  /**
   * Follow the agent's edits — when the ACTIVE session's
   * agent writes a normal code/text file, gently reveal it in the editor grid so the
   * user can watch it work. Off by default; when off, byte-identical behavior to
   * today (the auto-open of produced viewer documents is unaffected). A pure UI
   * behavior read per fs-change event — never touches the run.
   */
  followAgentEdits: z.object({ enabled: z.boolean() }).optional(),
  /**
   * On-save cleanup + formatting (trim trailing whitespace, insert a final
   * newline, format on save) — editor transforms applied to a file's content at save
   * time. `formatOnSave` runs the LSP formatter (`textDocument/formatting`) on
   * the buffer FIRST, then the two pure text cleanups compose on top of its
   * output (format → trim → final-newline). `formatOnSave` defaults ON; the two
   * text cleanups default off. A missing/slow/unsupported formatter falls
   * through to the un-formatted-but-still-text-cleaned save.
   */
  editorSave: z
    .object({
      trimTrailingWhitespace: z.boolean().optional(),
      ensureFinalNewline: z.boolean().optional(),
      formatOnSave: z.boolean().optional(),
    })
    .optional(),
  /**
   * `research` SSRF guard. OFF by default: every source and redirect hop is
   * rejected if it resolves to a loopback / private / link-local address, so a
   * public page cannot bounce the agent into `127.0.0.1` or `169.254.x`. Turning
   * `allowPrivate` on lifts that guard — the legitimate use is letting the agent
   * research your own dev server or a LAN host. Search itself is always keyless.
   */
  research: z.object({ allowPrivate: z.boolean().optional() }).optional(),
  /**
   * Local storage. `retentionDays` removes whole conversations with no message for that many
   * days (pinned and running ones excepted), once a day. Absent → history is kept until the
   * person removes it.
   */
  storage: z.object({ retentionDays: z.number().int().min(7).max(3650).optional() }).optional(),
}

export const agentSettingsSchema = z.object(agentSettingsShape)

export const userProfileSchema = z.object({
  userId: z.string(),
  uiSettings: uiSettingsSchema.nullable(),
  agentSettings: agentSettingsSchema.nullable(),
  updatedAt: z.string(),
})

const uiSettingsIngressSchema = uiSettingsSchema.refine(isUiSettingsWithinIngressBudget, {
  message: `UI settings must serialize to at most ${UI_SETTINGS_MAX_SERIALIZED_CHARS} characters`,
})
const agentSettingsIngressSchema = agentSettingsSchema.refine(isAgentSettingsWithinIngressBudget, {
  message: `Agent settings must serialize to at most ${AGENT_SETTINGS_MAX_SERIALIZED_CHARS} characters`,
})

/**
 * Atomic top-level agent-settings patch. `null` deletes one field; omitted fields
 * are preserved. It is projected from the canonical settings shape, so validation
 * cannot drift into a second settings schema.
 */
export const agentSettingsPatchSchema = z
  .object(nullablePatchShape(agentSettingsShape))
  .strict()
  .refine(isAgentSettingsWithinIngressBudget, {
    message: `Agent settings patch must serialize to at most ${AGENT_SETTINGS_MAX_SERIALIZED_CHARS} characters`,
  })

export const updateUserProfileRequestSchema = z
  .strictObject({
    uiSettings: uiSettingsIngressSchema.optional(),
    uiSettingsPatch: uiSettingsPatchSchema.optional(),
    agentSettings: agentSettingsIngressSchema.optional(),
    agentSettingsPatch: agentSettingsPatchSchema.optional(),
  })
  .superRefine((value, ctx) => {
    for (const [full, patch] of [
      ['uiSettings', 'uiSettingsPatch'],
      ['agentSettings', 'agentSettingsPatch'],
    ] as const) {
      if (value[full] && value[patch]) {
        ctx.addIssue({
          code: 'custom',
          path: [patch],
          message: `${full} and ${patch} are mutually exclusive`,
        })
      }
    }
  })

export type UiSettings = z.infer<typeof uiSettingsSchema>
export type UiSettingsPatch = z.infer<typeof uiSettingsPatchSchema>
export type AgentSettings = z.infer<typeof agentSettingsSchema>
export type AgentSettingsPatch = z.infer<typeof agentSettingsPatchSchema>

/** Validate stored UI settings instead of trusting the result of JSON.parse. */
export function normalizeUiSettings(value: unknown): UiSettings | null {
  const parsed = uiSettingsSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/**
 * One-way compatibility bridge for settings written before the composite
 * `research` capability replaced the separate web tools. Provider/key choices
 * are intentionally discarded; the only policy with equivalent semantics is
 * the explicit private-network opt-in.
 */
export function migrateLegacyResearchSettings(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const settings = value as Record<string, unknown>
  const legacyFetch =
    settings.webFetch && typeof settings.webFetch === 'object' && !Array.isArray(settings.webFetch)
      ? (settings.webFetch as Record<string, unknown>)
      : undefined
  const migratedResearch =
    settings.research ??
    (typeof legacyFetch?.allowPrivate === 'boolean'
      ? { allowPrivate: legacyFetch.allowPrivate }
      : undefined)
  const { webFetch: _webFetch, webSearch: _webSearch, ...canonical } = settings
  return {
    ...canonical,
    ...(migratedResearch !== undefined ? { research: migratedResearch } : {}),
  }
}

/**
 * Validate and normalize a stored settings value instead of trusting raw JSON.
 *
 * Persisted settings may contain a key removed from the current workload catalog.
 * A `partialRecord(enum, …)` correctly rejects that key on NEW writes, but letting
 * one retired nested key invalidate the whole stored envelope also switches every
 * current workload back to its default. Strip keys the current runtime cannot
 * execute, then validate all remaining values strictly. Nothing maps or revives a
 * retired route; the next settings write persists only the canonical catalog.
 */
export function normalizeAgentSettings(value: unknown): AgentSettings | null {
  let candidate = migrateLegacyResearchSettings(value)
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    const settings = candidate as Record<string, unknown>
    const routing = settings.modelRouting
    if (routing && typeof routing === 'object' && !Array.isArray(routing)) {
      candidate = {
        ...settings,
        modelRouting: Object.fromEntries(
          Object.entries(routing).filter(([key]) => isModelRoutingTaskKey(key)),
        ),
      }
    }
  }
  const parsed = agentSettingsSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

export type UserProfile = z.infer<typeof userProfileSchema>
export type UpdateUserProfileRequest = z.infer<typeof updateUserProfileRequestSchema>
