/**
 * SIGN-IN AND ACCESS: the engine's `AgentRuntimeAuth`, and the credential a request goes out with.
 *
 * A request uses the credential the host stored for the connection. An OAuth token close to its
 * expiry is refreshed inside the store's serialized `modify`, so two runs refreshing at once never
 * lose the newer refresh token; without a store, the run's own snapshot is refreshed in memory.
 */
import type {
  AgentRuntimeAuth,
  RuntimeAuthInteraction,
  RuntimeAuthProviderInfo,
  RuntimeAuthType,
  RuntimeCredential,
  RuntimeCredentialStore,
  RuntimeOAuthCredential,
} from '@localixai/agent/runtime'

import type { CatalogEntry } from '../catalog/catalog'
import { OAUTH_LOGINS, type OAuthLogin } from '../catalog/families'
import type { ProviderAccess } from '../providers/connect'
import { gitHubCopilotFlow } from './flows/github-copilot'
import { openAIChatGPTFlow } from './flows/openai-chatgpt'
import { openAICodexFlow } from './flows/openai-codex'
import { openRouterFlow } from './flows/openrouter'
import type { OAuthFlow } from './flows/types'

const FLOWS: Readonly<Record<OAuthLogin['flow'], OAuthFlow>> = {
  'openai-chatgpt': openAIChatGPTFlow,
  'openai-codex': openAICodexFlow,
  openrouter: openRouterFlow,
  'github-copilot': gitHubCopilotFlow,
}

/** Refresh a token this long before it lapses. */
const REFRESH_MARGIN_MS = 60_000

function flowFor(providerId: string): OAuthFlow | undefined {
  const login = OAUTH_LOGINS[providerId]
  return login ? FLOWS[login.flow] : undefined
}

export interface AuthOptions {
  credentialStore: RuntimeCredentialStore
  /** The providers to offer, with their names (the catalog's). */
  providers: () => readonly { id: string; name: string }[]
  getDeviceId?: () => string
}

export function createAuth(options: AuthOptions): AgentRuntimeAuth {
  return {
    listProviders(): readonly RuntimeAuthProviderInfo[] {
      return options.providers().flatMap((provider) => {
        const login = OAUTH_LOGINS[provider.id]
        return login
          ? [
              {
                id: provider.id,
                name: provider.name,
                methods: [
                  { type: 'oauth' as const, name: login.name, loginLabel: login.loginLabel },
                ],
              },
            ]
          : []
      })
    },

    async login(
      providerId: string,
      type: RuntimeAuthType,
      interaction: RuntimeAuthInteraction,
    ): Promise<RuntimeCredential> {
      const flow = flowFor(providerId)
      if (type !== 'oauth' || !flow)
        throw new Error(
          `${providerId} has no ${type === 'oauth' ? 'OAuth sign-in' : 'interactive API-key login'}`,
        )
      const signal = interaction.signal ?? new AbortController().signal
      return flow.login({
        interaction,
        signal,
        agentName: 'Localix',
        ...(options.getDeviceId ? { getDeviceId: options.getDeviceId } : {}),
      })
    },

    logout: (providerId) => options.credentialStore.delete(providerId),
  }
}

async function freshOAuth(
  providerId: string,
  snapshot: RuntimeOAuthCredential,
  flow: OAuthFlow,
  store: RuntimeCredentialStore | undefined,
  signal: AbortSignal,
): Promise<RuntimeOAuthCredential> {
  const stale = (credential: RuntimeOAuthCredential) =>
    credential.expiresAt - Date.now() < REFRESH_MARGIN_MS
  if (!store) return stale(snapshot) ? flow.refresh(snapshot, signal) : snapshot
  const current = await store.read(providerId)
  const stored = current?.type === 'oauth' ? current : snapshot
  if (!stale(stored)) return stored
  const refreshed = await store.modify(providerId, async (latest) => {
    const base = latest?.type === 'oauth' ? latest : stored
    // Another run may have refreshed while this one waited for the lock.
    return stale(base) ? flow.refresh(base, signal) : undefined
  })
  return refreshed?.type === 'oauth' ? refreshed : stored
}

/** How a request for `entry` reaches its provider with the run's credential. */
export async function accessFor(
  entry: CatalogEntry,
  credential: RuntimeCredential,
  options: { store?: RuntimeCredentialStore; signal: AbortSignal; sessionId?: string },
): Promise<{ access: ProviderAccess; subscription: boolean }> {
  if (credential.type === 'api-key') {
    const settings =
      credential.env && Object.keys(credential.env).length > 0
        ? { settings: { ...credential.env } }
        : {}
    return {
      access: { ...(credential.key ? { apiKey: credential.key } : {}), ...settings },
      subscription: false,
    }
  }
  const flow = flowFor(entry.provider.id)
  if (!flow)
    throw new Error(`${entry.provider.name} has no OAuth sign-in; reconnect it with an API key`)
  const fresh = await freshOAuth(entry.provider.id, credential, flow, options.store, options.signal)
  return {
    access: flow.access(fresh, options.sessionId ? { sessionId: options.sessionId } : {}),
    subscription: OAUTH_LOGINS[entry.provider.id]?.subscription === true,
  }
}
