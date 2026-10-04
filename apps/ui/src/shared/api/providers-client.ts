import { client, unwrap, assertOk } from './internal'
import type { EnvDetectedProvider, ProviderConnection } from './contracts'

/**
 * Provider-connection management: connections CRUD, OAuth handshake, per-key
 * operations. Spread into
 * `backendClient` — these stay independent of sessions/skills.
 */
export const providerConnectionsApi = {
  async listConnections(signal?: AbortSignal): Promise<ProviderConnection[]> {
    const json = await unwrap<{ connections: ProviderConnection[] }>(
      await client.rpc['provider-connections'].$get(undefined, {
        init: { signal },
      }),
    )
    return json.connections
  },

  async createConnection(input: {
    providerId: string
    providerName: string
    label: string
    apiKey: string
    apiKeys?: string[]
    authType?: 'api-key' | 'oauth-pkce'
  }): Promise<ProviderConnection> {
    return unwrap<ProviderConnection>(
      await client.rpc['provider-connections'].$post({
        json: {
          providerId: input.providerId,
          providerName: input.providerName,
          label: input.label,
          apiKey: input.apiKey,
          ...(input.apiKeys && input.apiKeys.length > 0 ? { apiKeys: input.apiKeys } : {}),
          authType: input.authType ?? 'api-key',
        },
      }),
    )
  },

  /** Providers whose API key the SERVER found in its environment (presence only — no key value). */
  async listEnvDetectedProviders(): Promise<EnvDetectedProvider[]> {
    const json = await unwrap<{ providers: EnvDetectedProvider[] }>(
      await client.rpc['provider-connections']['env-detected'].$get(),
    )
    return json.providers
  },

  /** Connect a provider using its env-var API key — the server reads it; it never crosses the wire. */
  async connectFromEnv(providerId: string): Promise<ProviderConnection> {
    return unwrap<ProviderConnection>(
      await client.rpc['provider-connections']['env-detected']['connect'].$post({
        json: { providerId },
      }),
    )
  },

  async updateConnection(
    id: string,
    patch: { label?: string; apiKey?: string },
  ): Promise<ProviderConnection> {
    return unwrap<ProviderConnection>(
      await client.rpc['provider-connections'][':id'].$patch({
        param: { id },
        json: patch,
      }),
    )
  },

  async initiateOAuth(input: {
    providerId: string
    providerName: string
    label: string
    callbackUrl: string
  }): Promise<{
    state: string
    mode: 'app-redirect' | 'local-server' | 'device-code'
    redirectUrl?: string
    userCode?: string
    verificationUri?: string
    expiresInSeconds?: number
    intervalSeconds?: number
  }> {
    return unwrap(
      await client.rpc['provider-connections']['oauth']['initiate'].$post({ json: input }),
    )
  },

  async completeOAuth(input: { code: string; state: string }): Promise<ProviderConnection> {
    return unwrap<ProviderConnection>(
      await client.rpc['provider-connections']['oauth']['callback'].$post({ json: input }),
    )
  },

  async deleteConnection(id: string): Promise<void> {
    const response = await client.rpc['provider-connections'][':id'].$delete({ param: { id } })
    await assertOk(response)
  },

  async addProviderKey(
    id: string,
    input: { apiKey: string; label?: string },
  ): Promise<ProviderConnection> {
    return unwrap<ProviderConnection>(
      await client.rpc['provider-connections'][':id']['keys'].$post({ param: { id }, json: input }),
    )
  },

  async updateProviderKey(
    id: string,
    keyId: string,
    patch: { label?: string; priority?: number; enabled?: boolean },
  ): Promise<ProviderConnection> {
    return unwrap<ProviderConnection>(
      await client.rpc['provider-connections'][':id']['keys'][':keyId'].$patch({
        param: { id, keyId },
        json: patch,
      }),
    )
  },

  async removeProviderKey(id: string, keyId: string): Promise<ProviderConnection> {
    return unwrap<ProviderConnection>(
      await client.rpc['provider-connections'][':id']['keys'][':keyId'].$delete({
        param: { id, keyId },
      }),
    )
  },
}
