import { z } from 'zod'
import { permissionRuleSchema } from '../projects/contracts'

/**
 * Wire contracts for the READ-ONLY effective-agent-configuration diagnostics
 * endpoint (`GET /rpc/effective-config`). This is a diagnostics VIEW over the
 * settings the runtime actually reads — it never mutates state and never leaks a
 * secret value, a raw system prompt, or connection credentials (only ids +
 * presence). It sits on top of the pure precedence resolver in
 * `effective-config.ts`; see that file for the user/project merge + migration.
 */

/**
 * Where a resolved value came from, in precedence order (later wins) — plus `unknown`.
 *
 * `unknown` is not a source: it is the honest answer when a source could NOT be read.
 * The report still carries a value (the resolver's fallback), but the read that would
 * have said whether that value is the effective one failed, and reporting `default`
 * there tells the reader a default is in force on the very screen they opened to ask
 * why their setting is not applying. The matching `*_unreadable` diagnostic says which
 * source and why.
 */
export type ConfigScope = 'default' | 'user' | 'project' | 'session' | 'mode' | 'plugin' | 'unknown'

/** How soon a change to a field takes effect. Advisory — see the plan's open decision #10. */
export type ReloadClass = 'immediate' | 'next-run' | 'new-session' | 'restart'

export type ConfigDiagnosticSeverity = 'info' | 'warning' | 'error'

export const configProvenanceSchema = z.object({
  scope: z.enum(['default', 'user', 'project', 'session', 'plugin', 'unknown']),
  /** Optional origin id (project id, plugin name). */
  sourceId: z.string().optional(),
})
export type ConfigProvenance = z.infer<typeof configProvenanceSchema>

export const configDiagnosticSchema = z.object({
  code: z.string(),
  severity: z.enum(['info', 'warning', 'error']),
  message: z.string(),
  /** Dotted settings path the diagnostic is about, when field-specific. */
  field: z.string().optional(),
})
export type ConfigDiagnostic = z.infer<typeof configDiagnosticSchema>

/** One model-consuming surface (the main session run, or a workload route) + its model. */
export const consumerResolutionSchema = z.object({
  /** Stable key, e.g. `session` or `modelRouting.inlineCompletion`. */
  id: z.string(),
  label: z.string(),
  /** True when the user configured an explicit slot for this consumer. */
  slotConfigured: z.boolean(),
  /** Resolved provider connection id (never the key/secret), or null when unresolved. */
  providerConnectionId: z.string().nullable(),
  modelId: z.string().nullable(),
  /** Whether SOME model resolves for this consumer (slot or fallback). */
  usable: z.boolean(),
  /** Which path produced the resolved model. */
  source: z.enum(['model-route', 'session', 'disabled', 'none']),
  reason: z.string().optional(),
})
export type ConsumerResolution = z.infer<typeof consumerResolutionSchema>

export const permissionSummaryEntrySchema = permissionRuleSchema.extend({
  /**
   * Which scope contributed the rule. `effective` is the composed answer the resolver
   * returned: the ceiling's rules with the agent's tightening ones appended, which is what
   * the run actually evaluates. `unknown` when the policy could not be read at all.
   */
  scope: z.enum(['default', 'user', 'project', 'effective', 'unknown']),
})
export type PermissionSummaryEntry = z.infer<typeof permissionSummaryEntrySchema>

/**
 * One tool the scope knows about but the next run will NOT receive, and why.
 *
 * `source` exists so a reader can act on the answer without parsing `reason` prose:
 * `settings` is the scope's own `disabledTools` (a switch they can flip), `capability` is
 * structural — the tool's owning plugin is disabled, so the tool is not merely denied, it
 * is absent.
 */
export const toolSurfaceDenialSchema = z.object({
  name: z.string(),
  reason: z.string(),
  source: z.enum(['settings', 'capability']),
})
export type ToolSurfaceDenial = z.infer<typeof toolSurfaceDenialSchema>

export const toolSurfaceSchema = z.object({
  /** Catalog tool names that survive the scope's own rules. */
  enabled: z.array(z.string()),
  /** Catalog tools removed by settings or by a disabled owner. */
  disabled: z.array(toolSurfaceDenialSchema),
})
export type ToolSurface = z.infer<typeof toolSurfaceSchema>

export const effectiveConfigScopeSchema = z.object({
  userId: z.string(),
  projectId: z.string().nullable(),
  sessionId: z.string().nullable(),
})

export const effectiveConfigReportSchema = z.object({
  schemaVersion: z.number(),
  /** Stable content hash of the resolved values — an ETag-style revision handle. */
  revision: z.string(),
  scope: effectiveConfigScopeSchema,
  /** The resolved settings object (project overrides user). */
  values: z.record(z.string(), z.unknown()),
  /** Per-key source attribution. */
  provenance: z.record(z.string(), configProvenanceSchema),
  /** Per-key hot-reload classification. */
  reload: z.record(z.string(), z.enum(['immediate', 'next-run', 'new-session', 'restart'])),
  diagnostics: z.array(configDiagnosticSchema),
  consumers: z.array(consumerResolutionSchema),
  tools: toolSurfaceSchema,
  permissions: z.array(permissionSummaryEntrySchema),
  skills: z.array(z.object({ name: z.string(), override: z.string() })),
  /** The mini apps whose backend tools the surface above counts. */
  miniApps: z.array(z.object({ name: z.string(), enabled: z.boolean() })),
})
export type EffectiveConfigReport = z.infer<typeof effectiveConfigReportSchema>

export const effectiveConfigQuerySchema = z.object({
  projectId: z.string().optional(),
  sessionId: z.string().optional(),
})
export type EffectiveConfigQuery = z.infer<typeof effectiveConfigQuerySchema>

/**
 * The composition dump is per SESSION, and the id is required: the roster is a per-run
 * decision (profile gating, activated tools, connected MCP servers), so there is no
 * meaningful installation-wide answer to give.
 */
export const compositionQuerySchema = z.object({
  sessionId: z.string().min(1),
})

/**
 * Two prompt-cache hashes to compare. Both come from a cache snapshot the caller already has
 * — the wire reports which FIELD changed between turns (`previous.changed`), and this answers
 * what changed inside it.
 */
export const promptDiffQuerySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
})
