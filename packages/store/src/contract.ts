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

/**
 * How far a source is trusted (`docs/internals/store-scale.md`, "Default sources"): it sets the
 * badge, the ranking weight and whether a plan is shown before an install.
 */
export const TRUSTS = ['localix', 'official', 'community'] as const
export const trustSchema = z.enum(TRUSTS)
export type Trust = z.infer<typeof trustSchema>

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

export const componentSchema = z.object({
  kind: componentKindSchema,
  name: z.string(),
  description: z.string().optional(),
})
export type StoreComponent = z.infer<typeof componentSchema>

const suitWords = z.array(z.string().min(1).max(100)).max(20)
export const suitsSchema = z.object({
  files: suitWords.optional(),
  dependencies: suitWords.optional(),
})
export type ListingSuits = z.infer<typeof suitsSchema>

/** The strings among `raw` that fit a suit word, as many as a listing holds. */
const looseWords = z.unknown().transform((raw) =>
  Array.isArray(raw)
    ? raw
        .filter((word): word is string => typeof word === 'string')
        .filter((word) => word.length > 0 && word.length <= 100)
        .slice(0, 20)
    : [],
)

/**
 * What a source says a package is for, read leniently (a marketplace's `metadata.localix.suits`,
 * a mini app catalog's `suits`): what is not a string is dropped, and what says nothing is
 * undefined rather than a reason to refuse the rest.
 */
export const sourceSuitsSchema = z
  .unknown()
  .transform((raw): ListingSuits | undefined => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
    const { files: rawFiles, dependencies: rawDependencies } = raw as Record<string, unknown>
    const files = looseWords.parse(rawFiles)
    const dependencies = looseWords.parse(rawDependencies)
    if (!files.length && !dependencies.length) return undefined
    return {
      ...(files.length ? { files } : {}),
      ...(dependencies.length ? { dependencies } : {}),
    }
  })
  // The field it is read from may be absent.
  .optional()

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
  source: z.object({
    id: z.string(),
    label: z.string(),
    /**
     * What a source says of itself. Absent: there is no source to rate — the person's own item,
     * a built-in type, a file of theirs — and the Store shows no trust label; it is ranked as
     * `community` would be.
     */
    trust: trustSchema.optional(),
    /** Its ranking weight, when the source's entry sets one other than its trust's. */
    weight: z.number().nonnegative().optional(),
  }),
  version: z.string().optional(),
  /** When this version was published, as ISO 8601: how fresh it is. */
  updatedAt: z.string().optional(),
  homepage: z.string().optional(),
  /**
   * Where the package comes from, normalized (`identity.ts`): two sources listing one origin show
   * one listing, under the source with the higher weight.
   */
  origin: z.string().optional(),
  /** The other sources that list the same origin. */
  alsoIn: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
  contents: z.union([
    z.partialRecord(componentKindSchema, z.number().int().nonnegative()),
    z.literal('unknown'),
  ]),
  /**
   * What it contains, one by one, when the provider knows before install: searched, and listed
   * on the capability shelves, which show components rather than packages.
   */
  components: z.array(componentSchema).optional(),
  runsCode: z.union([z.boolean(), z.literal('unknown')]),
  featured: z.boolean(),
  recommended: z.boolean(),
  installs: z.array(installSchema),
  job: jobSchema.optional(),
  /** Why it cannot be installed here. */
  incompatible: z.string().optional(),
  /**
   * Whether the source it comes from is signed with the key Localix keeps for it (a mini app
   * catalog's `.sig`): `mismatch` when it is signed with another, or no longer signed. Absent for
   * what no signed source carries.
   */
  signature: z.enum(['signed', 'unsigned', 'mismatch']).optional(),
  /**
   * Installed and able to update on its own: whether it does (`setAutoUpdate`). Absent when it
   * updates only when the person asks.
   */
  autoUpdate: z.boolean().optional(),
  /**
   * Written by the person (`user`) or kept in a project (`project`) rather than fetched from a
   * source: the Yours and Project shelves list it, installed or not.
   */
  authored: z.enum(['user', 'project']).optional(),
  /**
   * It comes with Localix or with an installed plugin and is not installed on its own: it has an
   * install state (it can be switched), but the Installed shelf lists the package it comes with.
   */
  bundled: z.boolean().optional(),
  /** It is installed and has settings: its page then shows a Settings tab (`ListingConfig`). */
  configurable: z.boolean().optional(),
  /**
   * What it is for, as its source says: file names at a project's root or open in a tab
   * (`compose.yaml`, `*.tf`; `*` stands for any characters) and packages a project depends on
   * (`prisma`, `@sentry/node`). Recommendations show it where they are (`recommend-rules.ts`).
   */
  suits: suitsSchema.optional(),
  /**
   * The kinds of file it opens, as its source declares them (a mini app's `fileAssociations`):
   * `docx`, `request.json`, `dockerfile`. A file tab offers it for a file it opens (`opensFile`).
   */
  opens: z.array(z.string()).optional(),
})
export type Listing = z.infer<typeof listingSchema>

export const listingDetailSchema = listingSchema.extend({
  /** More from its publisher, best first. */
  related: z.array(listingRefSchema).optional(),
  /** You might also like: listings of its category that share its tags, best first. */
  similar: z.array(listingRefSchema).optional(),
  /** The listings `related` and `similar` name, so the page draws their rows in one read. */
  linked: z.array(listingSchema).optional(),
  readme: z.string().nullable(),
  media: z.array(z.object({ url: z.string(), caption: z.string().optional() })),
  /** License, size, API version, homepage … in the provider's words. */
  facts: z.array(z.object({ label: z.string(), value: z.string() })),
  components: z.array(componentSchema),
  /**
   * Something the person should know about this item now, with the one thing to do about it: a
   * skill unused for long, archived soon unless pinned (`action` runs as the item's action).
   */
  notice: z
    .object({
      text: z.string(),
      action: z
        .object({ id: z.string(), label: z.string(), help: z.string().optional() })
        .optional(),
    })
    .optional(),
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
  trust: trustSchema.optional(),
  /** When it was last read into the Store, as ISO 8601. */
  syncedAt: z.string().optional(),
  /** Why it could not be read the last time, in one sentence. */
  problem: z.string().optional(),
  /** Whether it is read again, and what it installed updated, on its own; absent: no such switch. */
  autoUpdate: z.boolean().optional(),
  /** One a fresh profile starts with: once removed, it is not added back. */
  defaultSource: z.boolean().optional(),
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
