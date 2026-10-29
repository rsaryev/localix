import { z } from 'zod'
import { MINI_APP_CATEGORIES } from '@localixai/mini-app-sdk/manifest'

import {
  miniAppViewSchema,
  miniAppPromptSectionSchema,
  PROMPT_SECTIONS_MAX_PER_MINI_APP,
  VIEWS_MAX_PER_MINI_APP,
  type MiniAppViewSpec,
} from './contracts-contributions'

/**
 * The mini apps feature's own contracts: the host's view of a `mini-app.json` (the parts the SDK
 * leaves to the host to validate), the record the UI reads, and its requests. Nothing here is a
 * plugin's: a plugin's record and requests live in `features/plugins/contracts.ts`.
 */

/** Show an argument only after an earlier choice chip took a given value. */
export const miniAppCommandArgConditionSchema = z.object({ arg: z.string(), equals: z.string() })

/** One argument chip or picker of a mini app command; its value fills `${name}` in the prompt. */
export const miniAppCommandArgSchema = z.object({
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
   * DYNAMIC options: an app-relative script (run by `bun`) that prints `ArgOption[]` JSON for the
   * picker. Confined to the app's folder; run in the session's folder (`arg-options.ts`).
   */
  optionsScript: z.string().optional(),
  when: miniAppCommandArgConditionSchema.optional(),
})
export type MiniAppCommandArg = z.infer<typeof miniAppCommandArgSchema>

/** A mini app command as the host runs it: `/<app>:<name>`, its prompt filled from its args. */
export interface MiniAppCommand {
  name: string
  description: string
  prompt: string
  args: MiniAppCommandArg[]
  argumentHint?: string
  featured?: boolean
  activateTools?: string[]
}

/** The fields of `mini-app.json` the SDK leaves to the host, validated with the host's schemas. */
export const miniAppHostFieldsSchema = z.object({
  views: z.array(miniAppViewSchema).max(VIEWS_MAX_PER_MINI_APP).default([]),
  promptSections: z
    .array(miniAppPromptSectionSchema)
    .max(PROMPT_SECTIONS_MAX_PER_MINI_APP)
    .default([]),
  commandArgs: z.record(z.string(), z.array(miniAppCommandArgSchema)).default({}),
})
export type MiniAppHostFields = z.output<typeof miniAppHostFieldsSchema>

/** Model-facing metadata read from an enabled mini app's live tool definitions. */
export const miniAppToolDescriptorSchema = z.object({
  name: z.string(),
  label: z.string(),
  description: z.string(),
})
export type MiniAppToolDescriptor = z.infer<typeof miniAppToolDescriptorSchema>

/** A mini app's workbench UI artifact: URLs the host imports and a revision that moves with it. */
export const miniAppUiDescriptorSchema = z.object({
  entry: z.string(),
  styles: z.array(z.string()),
  revision: z.string(),
})
export type MiniAppUiDescriptor = z.infer<typeof miniAppUiDescriptorSchema>

/** A declared setting and its current value; a secret's value is never sent, only whether set. */
export const miniAppConfigFieldSchema = z.object({
  key: z.string(),
  type: z.string(),
  title: z.string().optional(),
  description: z.string(),
  required: z.boolean(),
  secret: z.boolean(),
  value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
  isSet: z.boolean(),
  min: z.number().optional(),
  max: z.number().optional(),
})
export type MiniAppConfigField = z.infer<typeof miniAppConfigFieldSchema>

/** One installed mini app, as the Store, the rail and the catalog show it. */
export const miniAppRecordSchema = z.object({
  name: z.string(),
  displayName: z.string().optional(),
  version: z.string().optional(),
  description: z.string(),
  category: z.enum(MINI_APP_CATEGORIES).optional(),
  /** Where people read about it: its homepage, else its repository's page (`miniAppWebsite`). */
  homepage: z.string().optional(),
  surfaces: z.array(z.string()),
  scope: z.enum(['global', 'project']),
  projectId: z.string(),
  dir: z.string(),
  enabled: z.boolean(),
  /** Installed and waiting for the person's yes; its code is not loaded. */
  awaitingConsent: z.boolean().optional(),
  error: z.string().optional(),
  hasBackend: z.boolean(),
  /** What its backend gives the agent, read from the live definitions while it is enabled. */
  tools: z.array(miniAppToolDescriptorSchema),
  backendSubsystems: z.array(z.string()),
  commands: z.array(z.string()),
  views: z.array(z.string()),
  hasGuide: z.boolean(),
  /** Where the host serves the icon its manifest names (`app-icon.ts`); absent when it has none. */
  icon: z.string().optional(),
  ui: miniAppUiDescriptorSchema.optional(),
  config: z.array(miniAppConfigFieldSchema),
})
export type MiniAppRecord = z.infer<typeof miniAppRecordSchema>

export const listMiniAppsResponseSchema = z.object({ miniApps: z.array(miniAppRecordSchema) })

export const setMiniAppEnabledRequestSchema = z.object({
  name: z.string().min(1),
  projectId: z.string().nullable().optional(),
  enabled: z.boolean(),
  /** Whose rule list the switch lands in; absent is the agent that always exists. */
  agentId: z.string().optional(),
})

export const removeMiniAppRequestSchema = z.object({
  name: z.string().min(1),
  projectId: z.string().nullable().optional(),
})

/**
 * An argument as the composer sees it: the options script's PATH never reaches the client, only
 * that the options load on demand (`dynamic`).
 */
export const miniAppCommandArgSpecSchema = miniAppCommandArgSchema
  .omit({ optionsScript: true })
  .extend({ dynamic: z.boolean().optional() })
export type MiniAppCommandArgSpec = z.infer<typeof miniAppCommandArgSpecSchema>

/** One mini app command as the composer offers it; the prompt stays on the server. */
export const miniAppCommandSpecSchema = z.object({
  app: z.string(),
  name: z.string(),
  /** `<app>:<name>` — what the person types after `/`. */
  fullName: z.string(),
  description: z.string(),
  args: z.array(miniAppCommandArgSpecSchema),
  argumentHint: z.string().optional(),
  featured: z.boolean().optional(),
})
export type MiniAppCommandSpec = z.infer<typeof miniAppCommandSpecSchema>

/** What enabled mini apps contribute to a scope, as the capability snapshot composes it. */
export interface MiniAppContributions {
  miniApps: MiniAppRecord[]
  views: MiniAppViewSpec[]
  commands: MiniAppCommandSpec[]
}
