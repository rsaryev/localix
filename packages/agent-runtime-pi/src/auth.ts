import {
  createModels,
  type AuthEvent,
  type AuthInteraction,
  type AuthPrompt,
  type Credential,
  type CredentialInfo,
  type CredentialStore,
  type Models,
  type Provider,
} from '@earendil-works/pi-ai'

import type {
  AgentRuntimeAuth,
  RuntimeAuthEvent,
  RuntimeAuthInteraction,
  RuntimeAuthPrompt,
  RuntimeAuthProviderInfo,
  RuntimeAuthType,
  RuntimeCredential,
  RuntimeCredentialStore,
} from '@localixai/agent/runtime'

import { piProviders } from './providers'

const OAUTH_RESERVED_FIELDS = new Set(['type', 'access', 'refresh', 'expires'])

function piAuthType(type: RuntimeAuthType): 'api_key' | 'oauth' {
  return type === 'api-key' ? 'api_key' : 'oauth'
}

export function toPiCredential(credential: RuntimeCredential): Credential {
  if (credential.type === 'api-key') {
    return { type: 'api_key', key: credential.key, env: credential.env }
  }

  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(credential.extra ?? {})) {
    if (!OAUTH_RESERVED_FIELDS.has(key)) extra[key] = value
  }
  return {
    ...extra,
    type: 'oauth',
    access: credential.accessToken,
    refresh: credential.refreshToken,
    expires: credential.expiresAt,
  }
}

export function fromPiCredential(credential: Credential): RuntimeCredential {
  if (credential.type === 'api_key') {
    return { type: 'api-key', key: credential.key, env: credential.env }
  }

  const { type: _type, access, refresh, expires, ...providerFields } = credential
  return {
    type: 'oauth',
    accessToken: access,
    refreshToken: refresh,
    expiresAt: expires,
    ...(Object.keys(providerFields).length > 0 ? { extra: providerFields } : {}),
  }
}

/** Bridges a host-scoped durable store to pi's provider-keyed credential contract. */
export class PiCredentialStoreAdapter implements CredentialStore {
  constructor(private readonly store: RuntimeCredentialStore) {}

  async read(providerId: string): Promise<Credential | undefined> {
    const credential = await this.store.read(providerId)
    return credential ? toPiCredential(credential) : undefined
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return (await this.store.list()).map((info) => ({
      providerId: info.providerId,
      type: piAuthType(info.type),
    }))
  }

  async modify(
    providerId: string,
    update: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    const result = await this.store.modify(providerId, async (current) => {
      const next = await update(current ? toPiCredential(current) : undefined)
      return next ? fromPiCredential(next) : undefined
    })
    return result ? toPiCredential(result) : undefined
  }

  delete(providerId: string): Promise<void> {
    return this.store.delete(providerId)
  }
}

function fromPiPrompt(prompt: AuthPrompt): RuntimeAuthPrompt {
  const signal = prompt.signal
  switch (prompt.type) {
    case 'text':
    case 'secret':
      return {
        type: prompt.type,
        message: prompt.message,
        placeholder: prompt.placeholder,
        signal,
      }
    case 'select':
      return {
        type: 'select',
        message: prompt.message,
        options: prompt.options.map((option) => ({ ...option })),
        signal,
      }
    case 'manual_code':
      return {
        type: 'manual-code',
        message: prompt.message,
        placeholder: prompt.placeholder,
        signal,
      }
  }
}

function fromPiEvent(event: AuthEvent): RuntimeAuthEvent {
  switch (event.type) {
    case 'info':
      return {
        type: 'info',
        message: event.message,
        links: event.links?.map((link) => ({ ...link })),
      }
    case 'auth_url':
      return { type: 'auth-url', url: event.url, instructions: event.instructions }
    case 'device_code':
      return {
        type: 'device-code',
        userCode: event.userCode,
        verificationUri: event.verificationUri,
        intervalSeconds: event.intervalSeconds,
        expiresInSeconds: event.expiresInSeconds,
      }
    case 'progress':
      return { type: 'progress', message: event.message }
  }
}

interface PiInteractionBridge {
  interaction: AuthInteraction
  drain(): Promise<void>
}

function createInteractionBridge(host: RuntimeAuthInteraction): PiInteractionBridge {
  let notificationTail = Promise.resolve()
  let notificationError: unknown

  const trackNotification = (event: RuntimeAuthEvent): void => {
    notificationTail = notificationTail
      .then(() => host.notify(event))
      .catch((error: unknown) => {
        notificationError ??= error
      })
  }

  return {
    interaction: {
      signal: host.signal,
      prompt: (prompt) => host.prompt(fromPiPrompt(prompt)),
      notify: (event) => trackNotification(fromPiEvent(event)),
    },
    async drain(): Promise<void> {
      await notificationTail
      if (notificationError !== undefined) throw notificationError
    },
  }
}

function providerInfo(provider: Provider): RuntimeAuthProviderInfo {
  const methods = []
  if (provider.auth.apiKey?.login) {
    methods.push({ type: 'api-key' as const, name: provider.auth.apiKey.name })
  }
  if (provider.auth.oauth) {
    methods.push({
      type: 'oauth' as const,
      name: provider.auth.oauth.name,
      ...(provider.auth.oauth.loginLabel ? { loginLabel: provider.auth.oauth.loginLabel } : {}),
    })
  }
  return { id: provider.id, name: provider.name, methods }
}

export interface PiAuthRuntimeOptions {
  credentialStore: RuntimeCredentialStore
  /** Host-owned, persistent installation UUID for subscription login. */
  getDeviceId?: () => string
  /** Adapter-level injection point used by conformance tests and custom pi providers. */
  providers?: readonly Provider[]
}

class PiAgentRuntimeAuth implements AgentRuntimeAuth {
  private readonly models: Models
  private readonly getDeviceId?: () => string

  constructor(options: PiAuthRuntimeOptions) {
    this.getDeviceId = options.getDeviceId
    const models = createModels({
      credentials: new PiCredentialStoreAdapter(options.credentialStore),
    })
    for (const provider of options.providers ?? piProviders()) {
      models.setProvider(provider)
    }
    this.models = models
  }

  listProviders(): readonly RuntimeAuthProviderInfo[] {
    return this.models.getProviders().map(providerInfo)
  }

  async login(
    providerId: string,
    type: RuntimeAuthType,
    hostInteraction: RuntimeAuthInteraction,
  ): Promise<RuntimeCredential> {
    const bridge = createInteractionBridge(hostInteraction)
    let credential: Credential
    try {
      credential = await this.models.login(providerId, piAuthType(type), bridge.interaction, {
        agentName: 'Localix',
        getDeviceId: this.getDeviceId,
      })
    } catch (error) {
      try {
        await bridge.drain()
      } catch {
        // The login failure is primary; notification transport is secondary.
      }
      throw error
    }
    await bridge.drain()
    return fromPiCredential(credential)
  }

  logout(providerId: string): Promise<void> {
    return this.models.logout(providerId)
  }
}

export function createPiAuthRuntime(options: PiAuthRuntimeOptions): AgentRuntimeAuth {
  return new PiAgentRuntimeAuth(options)
}
