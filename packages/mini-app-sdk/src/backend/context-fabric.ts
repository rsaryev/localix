/**
 * Context-fabric contracts — the context-provider surface a plugin backend
 * contributes to (`ContextProviderContribution`, `ContextResolver`,
 * `AutomaticContextProvider`, and the value types they exchange). Pure types:
 * the host (`apps/api`) implements the fabric and consumes these; plugins only
 * describe the contributions they register. Moved here so plugins depend on the
 * SDK instead of deep-importing `apps/api/src/features/context-fabric/contracts`.
 */

/**
 * Who the context is for. `inline-completion` serves every text-input ghost surface (chat
 * composer, commit subject, any plugin field) and `edit-prediction` every editor; a provider
 * declares which of them its content suits, so a keystroke never pays for a chat-sized read.
 */
export type ContextDestination =
  | 'chat'
  | 'edit-prediction'
  | 'inline-completion'
  | 'title-generation'
  | 'subagent'

export type ContextScope = 'document' | 'project' | 'session' | 'global'
export type ContextSensitivity = 'public' | 'project' | 'sensitive' | 'forbidden'

/** Scalar facts a reference carries for its resolver (a path, a line range, a message id). */
export type ContextReferenceAttributes = Readonly<Record<string, string | number | boolean>>

export interface ContextReference {
  version: 1
  id: string
  kind: string
  uri?: string
  presentation: { token?: string; label: string }
  freshness: 'resolve-at-send' | 'snapshot'
  scope: { userId: string; projectId?: string; sessionId?: string; isolationId?: string }
  /**
   * The same open attribute bag a message binding's target carries. With it a binding IS a
   * reference: nothing converts one into a narrower host shape and back, and a resolver reads the
   * facts the producer attached instead of a fixed list someone remembered to copy.
   */
  attributes?: ContextReferenceAttributes
}

/**
 * The kind of a contribution that explains why a reference produced no content ("file not
 * found", "exchange offline"). A user who linked something is owed either its content or the
 * reason it is missing; this kind lets a resolver say which without the host guessing, and lets
 * the host report the reference as failed while the model still reads the reason.
 */
export const CONTEXT_UNAVAILABLE_KIND = 'unavailable'

export interface ContextContribution {
  id: string
  providerId: string
  providerVersion: string
  scope: ContextScope
  /** Open semantic label owned by the provider (for example `schema` or
   * `kubernetes-manifest`). Core uses it only for diagnostics/serialization. */
  kind: string
  content: string
  uri?: string
  /** Filesystem provenance is intentionally separate from opaque `uri`. Only a
   * host/provider that actually read a local file may set it; policy validates it
   * against the trusted workspace root before model serialization. */
  source?: { path: string }
  range?: { start: { line: number; character: number }; end: { line: number; character: number } }
  revision?: string
  priority: number
  sensitivity: ContextSensitivity
  relevanceHints?: { symbols?: string[]; recency?: number; explicit?: boolean }
  ttlMs?: number
}

export interface ContextEstimate {
  bytes: number
  tokens?: number
  revision?: string
}

export interface ResolveContext {
  destination: ContextDestination
  userId: string
  projectId?: string
  sessionId?: string
  isolationId?: string
  /** Trusted effective workspace identity, assigned server-side. It must never be
   * populated from a client filepath or opaque resource URI. */
  workspace?: {
    rootPath: string
    isolationId?: string
    /** User/project tightening rules, expressed relative to this trusted root. */
    excludedRelativePaths?: string[]
  }
  maxBytes: number
  maxTokens?: number
  /**
   * How many contributions the destination packs; 8 when absent. It belongs to the REQUEST, not
   * to the provider: a keystroke wants a few excerpts, a sent message every chip the user added.
   */
  maxItems?: number
  /** Host-owned end-to-end deadline (Unix milliseconds). Provider `timeoutMs`
   * remains a per-invocation ceiling and is clipped to this remaining budget. */
  deadlineAtMs?: number
}

export interface ContextResolver {
  readonly id: string
  readonly version: string
  supports(ref: ContextReference, destination: ContextDestination): boolean
  estimate(
    ref: ContextReference,
    ctx: ResolveContext,
    signal: AbortSignal,
  ): Promise<ContextEstimate>
  resolve(
    ref: ContextReference,
    ctx: ResolveContext,
    signal: AbortSignal,
  ): Promise<ContextContribution[]>
}

export interface AutomaticContextRequest extends ResolveContext {
  document?: { uri: string; languageId: string; revision: string; content: string }
  /** Host-normalized same-document edit events. This stays task-envelope data, not
   * a raw client-context escape hatch for providers. */
  editHistory?: { before?: string[]; lines: string[]; startLine?: number; endLine?: number }[]
  cursor?: { line: number; character: number }
  selection?: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
}

export interface AutomaticContextProvider {
  readonly id: string
  readonly version: string
  readonly destinations: readonly ContextDestination[]
  readonly sensitivity: ContextSensitivity
  provide(req: AutomaticContextRequest, signal: AbortSignal): Promise<ContextContribution[]>
}

export interface ContextProviderContribution {
  provider: ContextResolver | AutomaticContextProvider
  destinations: readonly ContextDestination[]
  activation: 'explicit' | 'automatic'
  defaultEnabled: boolean
  maxTokens: number
  timeoutMs: number
  sensitivity: ContextSensitivity
  /**
   * A generic resolver that bridges a whole scheme (every `localix://resource/*`) and should be
   * consulted only when no specific resolver supports the reference. Without it the first
   * registered resolver answered: core's generic bridge registers before plugins load, so it
   * silently shadowed every plugin's own resolver and its priority/kind semantics.
   */
  fallback?: boolean
}
