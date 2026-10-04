/** Authentication mechanism understood by the engine-neutral runtime boundary. */
export type RuntimeAuthType = 'api-key' | 'oauth'

/** API key plus optional provider-scoped configuration values. */
export interface RuntimeApiKeyCredential {
  type: 'api-key'
  key?: string
  env?: Readonly<Record<string, string>>
}

/** Canonical OAuth token set. Provider-specific fields remain opaque to the host. */
export interface RuntimeOAuthCredential {
  type: 'oauth'
  accessToken: string
  refreshToken: string
  /** Unix epoch in milliseconds. */
  expiresAt: number
  extra?: Readonly<Record<string, unknown>>
}

export type RuntimeCredential = RuntimeApiKeyCredential | RuntimeOAuthCredential

/** Secret-free credential metadata for account and connection status views. */
export interface RuntimeCredentialInfo {
  providerId: string
  type: RuntimeAuthType
}

/**
 * A credential store is already scoped to one host-owned credential set (for
 * example one user connection). Provider ids are only keys inside that scope.
 *
 * `modify` must serialize read-modify-write per provider, including across
 * processes when the backing store supports it. OAuth refresh executes inside
 * this callback, so this guarantee prevents concurrent token rotation from
 * losing the newest refresh token. Returning `undefined` from the callback
 * leaves the current value unchanged; `modify` returns the post-operation
 * value.
 */
export interface RuntimeCredentialStore {
  read(providerId: string): Promise<RuntimeCredential | undefined>
  list(): Promise<readonly RuntimeCredentialInfo[]>
  modify(
    providerId: string,
    update: (current: RuntimeCredential | undefined) => Promise<RuntimeCredential | undefined>,
  ): Promise<RuntimeCredential | undefined>
  delete(providerId: string): Promise<void>
}

/** Opens an isolated credential store without exposing tenant concepts to an engine adapter. */
export interface RuntimeCredentialStoreProvider {
  open(scopeId: string): RuntimeCredentialStore | Promise<RuntimeCredentialStore>
}

export interface RuntimeAuthPromptOption {
  id: string
  label: string
  description?: string
}

export type RuntimeAuthPrompt = { signal?: AbortSignal } & (
  | { type: 'text'; message: string; placeholder?: string }
  | { type: 'secret'; message: string; placeholder?: string }
  | {
      type: 'select'
      message: string
      options: readonly RuntimeAuthPromptOption[]
    }
  | { type: 'manual-code'; message: string; placeholder?: string }
)

export interface RuntimeAuthLink {
  url: string
  label?: string
}

export type RuntimeAuthEvent =
  | { type: 'info'; message: string; links?: readonly RuntimeAuthLink[] }
  | { type: 'auth-url'; url: string; instructions?: string }
  | {
      type: 'device-code'
      userCode: string
      verificationUri: string
      intervalSeconds?: number
      expiresInSeconds?: number
    }
  | { type: 'progress'; message: string }

/**
 * Host-owned interaction channel. Implementations may persist events and
 * resolve prompts through HTTP, WebSocket, or a local terminal.
 */
export interface RuntimeAuthInteraction {
  signal?: AbortSignal
  prompt(prompt: RuntimeAuthPrompt): Promise<string>
  notify(event: RuntimeAuthEvent): void | Promise<void>
}

export interface RuntimeAuthMethodInfo {
  type: RuntimeAuthType
  name: string
  loginLabel?: string
}

export interface RuntimeAuthProviderInfo {
  id: string
  name: string
  methods: readonly RuntimeAuthMethodInfo[]
}

/** Engine-neutral authentication operations delegated to a runtime adapter. */
export interface AgentRuntimeAuth {
  listProviders(): readonly RuntimeAuthProviderInfo[]
  login(
    providerId: string,
    type: RuntimeAuthType,
    interaction: RuntimeAuthInteraction,
  ): Promise<RuntimeCredential>
  logout(providerId: string): Promise<void>
}
