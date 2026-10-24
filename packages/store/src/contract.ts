import { z } from 'zod'

/**
 * THE STORE'S CONTRACT (`docs/internals/store.md`, "Contract"): what a provider hands the Store and
 * what the Store hands a client. It names no provider and parses no package format; a provider
 * projects its own records into these shapes.
 */

/** What is downloaded, versioned, installed and removed as one unit. */
export const PACKAGE_KINDS = ['mini-app', 'plugin', 'mcp-server', 'skill', 'agent'] as const
export const packageKindSchema = z.enum(PACKAGE_KINDS)
export type PackageKind = z.infer<typeof packageKindSchema>

/** Something a package adds. Never installed alone: a fact about a package. */
export const COMPONENT_KINDS = [
  'skill',
  'agent',
  'command',
  'hook',
  'mod',
  'mcp-server',
  'lsp-server',
  'output-style',
  'monitor',
  'theme',
  'screen',
  'backend',
  'agent-tool',
] as const
export const componentKindSchema = z.enum(COMPONENT_KINDS)
export type ComponentKind = z.infer<typeof componentKindSchema>

/** Where an install lives: for the person, or for one project (Claude Code's `local`). */
export const scopeSchema = z.enum(['user', 'project'])
export type Scope = z.infer<typeof scopeSchema>

/** The union of every provider's job phases. */
export const jobPhaseSchema = z.enum(['queued', 'downloading', 'installing', 'done', 'failed'])
export type JobPhase = z.infer<typeof jobPhaseSchema>

/** A package by kind and an id that is stable across its sources' refreshes. */
export const listingRefSchema = z.object({ kind: packageKindSchema, id: z.string().min(1) })
export type ListingRef = z.infer<typeof listingRefSchema>

export const installSchema = z.object({
  scope: scopeSchema,
  version: z.string().optional(),
  enabled: z.boolean(),
  /** A newer version its source offers. */
  updateTo: z.string().optional(),
})
export type StoreInstall = z.infer<typeof installSchema>

export const jobSchema = z.object({
  action: z.enum(['install', 'update', 'remove']),
  phase: jobPhaseSchema,
  received: z.number().optional(),
  total: z.number().optional(),
  error: z.string().optional(),
})
export type StoreJob = z.infer<typeof jobSchema>

/** The Store's read-only projection of one package, for display and search. */
export const listingSchema = z.object({
  ref: listingRefSchema,
  name: z.string(),
  displayName: z.string(),
  summary: z.string(),
  /** A provider media address; absent, the UI draws a monogram tile. */
  icon: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()),
  publisher: z.object({ name: z.string(), verified: z.boolean() }),
  source: z.object({ id: z.string(), label: z.string() }),
  version: z.string().optional(),
  contents: z.union([
    z.partialRecord(componentKindSchema, z.number().int().nonnegative()),
    z.literal('unknown'),
  ]),
  /** The names of what it contains, when the provider knows them before install; searched. */
  componentNames: z.array(z.string()).optional(),
  runsCode: z.union([z.boolean(), z.literal('unknown')]),
  featured: z.boolean(),
  recommended: z.boolean(),
  installs: z.array(installSchema),
  job: jobSchema.optional(),
  /** Why it cannot be installed here. */
  incompatible: z.string().optional(),
  /** A `localix://` address of the provider's own settings for it, when it has any. */
  configure: z.string().optional(),
})
export type Listing = z.infer<typeof listingSchema>

export const componentSchema = z.object({
  kind: componentKindSchema,
  name: z.string(),
  description: z.string().optional(),
})
export type StoreComponent = z.infer<typeof componentSchema>

export const listingDetailSchema = listingSchema.extend({
  readme: z.string().nullable(),
  media: z.array(z.object({ url: z.string(), caption: z.string().optional() })),
  /** License, size, API version, homepage … in the provider's words. */
  facts: z.array(z.object({ label: z.string(), value: z.string() })),
  components: z.array(componentSchema),
})
export type ListingDetail = z.infer<typeof listingDetailSchema>

/** What an install will add and run, computed before anything is written. */
export const installPlanSchema = z.object({
  scope: scopeSchema,
  adds: z.array(componentSchema),
  runs: z.array(
    z.object({ kind: componentKindSchema, name: z.string(), command: z.string().optional() }),
  ),
  /** Hosts a remote server or backend reaches, when declared. */
  network: z.array(z.string()),
  /** Packages installed with it: the same kind only (X1). */
  requires: z.array(listingRefSchema),
  warnings: z.array(z.string()),
  needsConsent: z.boolean(),
})
export type InstallPlan = z.infer<typeof installPlanSchema>

/** One place a provider reads packages from. */
export const sourceViewSchema = z.object({
  kind: packageKindSchema,
  id: z.string(),
  label: z.string(),
  /** Where it lives, as the person would type it. */
  url: z.string(),
  /** Comes with Localix: never removed. */
  builtIn: z.boolean(),
  /** How many packages it offers now. */
  count: z.number().int().nonnegative(),
})
export type SourceView = z.infer<typeof sourceViewSchema>

/** What a source would add, read before it is added. */
export const sourcePreviewSchema = z.object({
  kind: packageKindSchema,
  /** The normalised address `addSource` keeps. */
  id: z.string(),
  label: z.string(),
  publishers: z.array(z.string()),
  count: z.number().int().nonnegative(),
  icons: z.array(z.object({ name: z.string(), label: z.string(), src: z.string() })),
  verified: z.boolean(),
  added: z.boolean(),
})
export type SourcePreview = z.infer<typeof sourcePreviewSchema>
