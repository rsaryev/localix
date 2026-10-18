export type ProviderAuthType = 'oauth-pkce' | 'api-key'

export type ProviderUsageCapabilityKind = 'none' | 'api' | 'oauth' | 'local' | 'mixed'

export type ProviderUsageSource = 'api-key' | 'oauth' | 'local'

export interface ModelCostRates {
  /** USD per million input tokens. */
  input: number
  /** USD per million output tokens. */
  output: number
  cacheRead?: number
  cacheWrite?: number
}

export interface ModelCostTier extends ModelCostRates {
  /** Use these rates when one model request exceeds this many input-class tokens. */
  inputTokensAbove: number
}

export interface ModelCost extends ModelCostRates {
  /** Provider pricing tiers, evaluated per request rather than over run totals. */
  tiers?: ModelCostTier[]
}

/**
 * What a model is for. One catalog lists every kind, and each consumer asks for its own: chat
 * workloads for `chat`, semantic search for `embedding`. Absent means `chat` (every model a
 * runtime adapter lists).
 */
export type ModelKind = 'chat' | 'embedding'

export interface CatalogModel {
  id: string
  name: string
  kind?: ModelKind
  providerId: string
  providerName: string
  contextLength?: number
  outputLimit?: number
  releaseDate?: string
  supportsTools: boolean
  supportsReasoning: boolean
  /**
   * The reasoning levels this model actually offers, strongest last (`off` excluded — that is
   * every model's floor). Empty when it does no reasoning.
   *
   * Published because a preference is stored per provider/model pair and outlives the model it
   * was chosen for: without this the picker offers a level the runtime will quietly clamp, and
   * before the clamp existed it ended the run. The capability belongs to the model, so it
   * travels with it — the same shape pi and opencode give their model entries.
   */
  reasoningEfforts?: string[]
  /**
   * The wire protocol this model is served over (`anthropic-messages`,
   * `openai-completions`, …). Two models behave differently for reasons that live here —
   * which parameters exist, how reasoning is expressed, what a failure looks like — so the
   * detail panel states it instead of leaving a person to infer it from the provider.
   */
  api?: string
  supportsAttachment: boolean
  inputModalities: string[]
  outputModalities: string[]
  cost?: ModelCost
  /** Human-readable pricing for models the token rates cannot describe (e.g. a router). */
  pricingLabel?: string
  family?: string
  /** An embedding model's vector widths: what it returns, and what an index stores of it. */
  embedding?: { dimensions: number; storedDimensions: number }
}

/** Catalog metadata needed to display and configure a model provider. */
export interface CatalogProvider {
  id: string
  name: string
  apiBaseUrl?: string
  npm?: string
  modelCount: number
  authType: ProviderAuthType
  doc?: string
  usageCapability?: ProviderUsageCapabilityKind
  usageSources?: ProviderUsageSource[]
  dashboardUrl?: string
  statusUrl?: string
}

export type ProviderEntry = CatalogProvider
