import { z } from 'zod'

export const catalogProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  apiBaseUrl: z.string().optional(),
  npm: z.string().optional(),
  modelCount: z.number().int().nonnegative(),
  authType: z.enum(['api-key', 'oauth-pkce']),
  doc: z.string().optional(),
})

const modelCostRatesSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number().optional(),
  cacheWrite: z.number().optional(),
})

const modelCostSchema = modelCostRatesSchema.extend({
  tiers: z
    .array(modelCostRatesSchema.extend({ inputTokensAbove: z.number().nonnegative() }))
    .optional(),
})

export const catalogModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Absent: a chat model. */
  kind: z.enum(['chat', 'embedding']).optional(),
  providerId: z.string(),
  providerName: z.string(),
  contextLength: z.number().int().nonnegative().optional(),
  outputLimit: z.number().int().nonnegative().optional(),
  releaseDate: z.string().optional(),
  supportsTools: z.boolean(),
  supportsReasoning: z.boolean().default(false),
  /**
   * The reasoning levels this model offers, strongest last. EMPTY means it reasons at none;
   * ABSENT means the producer does not publish the capability, and the whole scale is offered
   * (the runtime clamps either way).
   */
  reasoningEfforts: z.array(z.string()).optional(),
  /** Wire protocol the model is served over, as the runtime names it. */
  api: z.string().optional(),
  supportsAttachment: z.boolean().default(false),
  inputModalities: z.array(z.string()).default([]),
  outputModalities: z.array(z.string()).default([]),
  cost: modelCostSchema.optional(),
  pricingLabel: z.string().optional(),
  family: z.string().optional(),
  embedding: z
    .object({
      dimensions: z.number().int().positive(),
      storedDimensions: z.number().int().positive(),
    })
    .optional(),
})

export const catalogResponseSchema = z.object({
  providers: z.array(catalogProviderSchema),
  models: z.array(catalogModelSchema),
  /** Provider ids that support an OAuth login flow (server-side OAuth adapter registry). */
  oauthProviderIds: z.array(z.string()).default([]),
  /** OAuth-login metadata per provider (label + description for the UI). */
  oauthProviders: z
    .array(
      z.object({ providerId: z.string(), loginLabel: z.string(), loginDescription: z.string() }),
    )
    .default([]),
})

export type CatalogResponse = z.infer<typeof catalogResponseSchema>

/** The outcome of an on-demand model-list check (`POST /rpc/models/catalog/refresh`). */
export const catalogRefreshResponseSchema = z.object({
  /** Every source answered and every provider published. */
  ok: z.boolean(),
  /** A provider's model list changed; a client refetches the catalog. */
  changed: z.boolean(),
  /** Providers whose check failed; each keeps its previous list. */
  failedProviders: z.array(z.string()),
  /** The distinct failure messages, when any. */
  message: z.string().optional(),
})

export type CatalogRefreshResponse = z.infer<typeof catalogRefreshResponseSchema>
