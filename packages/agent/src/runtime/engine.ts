/**
 * THE ENGINE: everything one provider adapter hands the host, as one value.
 *
 * The host used to reach for the adapter four times — the agent loop, the buffered
 * completion factory, the OAuth runtime, the model catalog — each through
 * its own `createPi…` constructor, and typed its composition root by `ReturnType<typeof
 * createPi…>` so that the concrete adapter leaked into every phase that named those fields.
 * The `AgentRuntimeFactory` port beside them was declared and never used.
 *
 * An engine is the whole set behind one id, so a second adapter is a second factory and a
 * one-line change in the composition root, and every phase downstream is typed by the ports.
 * The ports stay separate on purpose: a run needs the loop and nothing else, a summary needs
 * only a completion, the connections service needs only auth — the engine bundles what the
 * ROOT wires, not what each consumer sees.
 */
import type { AgentRuntime, LanguageModelFactory } from './index'
import type { AgentRuntimeAuth, RuntimeCredentialStore } from './auth'
import type { CatalogModel, CatalogProvider } from '../catalog/types'

/** What the adapter knows about the models it can drive. */
export interface EngineCatalog {
  providers: CatalogProvider[]
  models: CatalogModel[]
  /** Provider ids that support an OAuth login flow. */
  oauthProviderIds: string[]
  /** OAuth-login metadata per provider (label + description for a UI). */
  oauthProviders: { providerId: string; loginLabel: string; loginDescription: string }[]
}

export interface AgentEngine {
  /** Persisted with every run so stored entries remain decodable after adapter upgrades. */
  readonly id: string
  readonly version: string
  /** The agent loop — the only interface application code uses to start a run. */
  readonly runtime: AgentRuntime
  /** Buffered single completions for the auxiliary calls (summary, title, judge). */
  readonly languageModels: LanguageModelFactory
  /** OAuth login/refresh over the host's credential store. */
  createAuth(credentialStore: RuntimeCredentialStore): AgentRuntimeAuth
  /** The catalog of providers and models this engine can serve, with the adapter's metadata. */
  listCatalog(): Promise<EngineCatalog>
  /**
   * Changes whenever `listCatalog()` would answer differently (provider metadata that landed after
   * the first build). A host that caches the catalog compares this instead of freezing its first
   * build — a frozen build is how the picker and the per-request clamp came to disagree.
   */
  catalogRevision(): number
}
