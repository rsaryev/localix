/**
 * SIGN-IN AND ACCESS: the engine's `AgentRuntimeAuth`, and the credential a request goes out with.
 *
 * A request uses the credential the host stored for the connection. An OAuth credential is kept
 * fresh for the whole run (`oauth-access`); without a store, the run's own snapshot is refreshed
 * in memory.
 */
import type {
  AgentRuntimeAuth,
  RuntimeAuthInteraction,
  RuntimeAuthProviderInfo,
  RuntimeAuthType,
  RuntimeCredential,
  RuntimeCredentialStore,
} from '@localixai/agent/runtime'

import type { CatalogEntry } from '../catalog/catalog'
import { OAUTH_LOGINS, type OAuthLogin } from '../catalog/families'
import type { ProviderAccess } from '../providers/connect'
import { gitHubCopilotFlow } from './flows/github-copilot'
import { openAIChatGPTFlow } from './flows/openai-chatgpt'
import { openAICodexFlow } from './flows/openai-codex'
import { openRouterFlow } from './flows/openrouter'
import type { OAuthFlow } from './flows/types'
import { freshOAuth, refreshingAccess } from './oauth-access'

const FLOWS: Readonly<Record<OAuthLogin['flow'], OAuthFlow>> = {
  'openai-chatgpt': openAIChatGPTFlow,
  'openai-codex': openAICodexFlow,
  openrouter: openRouterFlow,
  'github-copilot': gitHubCopilotFlow,
}

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
  const providerId = entry.provider.id
  const fresh = await freshOAuth(providerId, credential, flow, options.store)
  const request = options.sessionId ? { sessionId: options.sessionId } : {}
  return {
    // Checked again before every request: a long run outlives a short-lived token.
    access: refreshingAccess(providerId, fresh, flow, options.store, request),
    subscription: OAUTH_LOGINS[providerId]?.subscription ?? false,
  }
}
