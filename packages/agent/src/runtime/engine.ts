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
import type { ScriptSandbox } from './scripts'
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

/**
 * Where the adapter persists refreshed provider catalogs between launches: one opaque JSON entry
 * per provider id. The adapter owns the entry's shape and validates what it reads back.
 */
export interface EngineCatalogStore {
  read(providerId: string): Promise<unknown>
  write(providerId: string, entry: unknown): Promise<void>
  delete(providerId: string): Promise<void>
}

export interface EngineCatalogRefreshOptions {
  /** False restores persisted catalogs only; true also fetches newer ones. */
  allowNetwork: boolean
  /** Fetch even where the persisted catalog is still fresh. */
  force?: boolean
  signal?: AbortSignal
}

export interface EngineCatalogRefreshResult {
  /**
   * A provider published a model list (a restore from the store included), so a cached
   * `listCatalog()` answer may be stale.
   */
  changed: boolean
  aborted: boolean
  /** Providers whose refresh failed; each keeps its previous list. */
  errors: { providerId: string; message: string }[]
}

export interface AgentEngine {
  /** Persisted with every run so stored entries remain decodable after adapter upgrades. */
  readonly id: string
  readonly version: string
  /** The agent loop — the only interface application code uses to start a run. */
  readonly runtime: AgentRuntime
  /** Buffered single completions for the auxiliary calls (summary, title, judge). */
  readonly languageModels: LanguageModelFactory
  /**
   * Runs model-written scripts whose only capability is calling the tools handed to them
   * (`./scripts`). Absent when the engine has no sandbox; the tool that needs it is then absent too.
   */
  readonly scripts?: ScriptSandbox
  /** OAuth login/refresh over the host's credential store. */
  createAuth(credentialStore: RuntimeCredentialStore): AgentRuntimeAuth
  /** The catalog of providers and models this engine can serve, with the adapter's metadata. */
  listCatalog(): Promise<EngineCatalog>
  /**
   * Restore persisted catalogs and, with `allowNetwork`, fetch newer ones. Never rejects for a
   * provider's failure: it is reported in `errors` and that provider keeps its list.
   */
  refreshCatalog(options: EngineCatalogRefreshOptions): Promise<EngineCatalogRefreshResult>
  /**
   * Forget the built catalog: a provider whose list the HOST owns (local models) changed it.
   * The next `listCatalog()` builds again.
   */
  invalidateCatalog?(): void
}
