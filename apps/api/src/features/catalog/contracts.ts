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
