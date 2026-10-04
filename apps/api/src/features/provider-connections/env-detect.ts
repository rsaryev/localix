import { ApiError } from '../../lib/errors'
import { providerOffersChat, type ProviderEntry } from '@localixai/agent/catalog'
import type { ConnectFromEnvRequest, EnvDetectedProvider, ProviderConnection } from './contracts'

/**
 * Onboarding env-key auto-detection: which providers already have an API key
 * sitting in the SERVER's environment, and connecting one of them.
 *
 * Two invariants live here, and nowhere else:
 *
 *  - **Presence-only.** The env-var NAME crosses the wire; its VALUE never does.
 *    The client connects by `providerId` alone, and the secret is read here,
 *    server-side, straight into the key store. A response shape that carried the
 *    value would leak every provider key to any caller who can list providers.
 *
 *  - **An env var IS an api key.** So the connection is `api-key` auth whatever
 *    the catalog says the provider's auth type is — a provider that normally
 *    does OAuth still connects by key when a key is what the environment has.
 *
 * The env-var names come from the in-process catalog (`ProviderEntry.env`, which the
 * runtime adapter asks of each provider's own auth resolver) — never a hardcoded
 * provider map, so a new provider needs no code here. The route strips `env` from
 * the wire; only this server-side reader sees it.
 */

export interface EnvDetectDeps {
  /** The environment to search. Injected so tests need not mutate `process.env`. */
  env: Record<string, string | undefined>
  /** The provider catalog. Absent/empty (tests, offline) → nothing is detected. */
  catalogProviders?: () => Promise<ProviderEntry[]>
  /** Provider ids the user has already connected — those are never offered again. */
  connectedProviderIds: (userId: string) => Promise<Set<string>>
  /** The service's own connection-create path, so an env connect is not a second one. */
  createConnection: (
    userId: string,
    input: {
      providerId: string
      providerName: string
      label: string
      authType: 'api-key'
      apiKey: string
    },
  ) => Promise<ProviderConnection>
}

export interface EnvDetect {
  /**
   * Providers whose API key is present in the environment and that the user has
   * not connected yet. Drives the onboarding "Detected in your environment"
   * one-click connect.
   */
  listEnvDetectedProviders: (userId: string) => Promise<{ providers: EnvDetectedProvider[] }>
  /** Connect a provider using the API key found in the environment. */
  connectFromEnv: (userId: string, input: ConnectFromEnvRequest) => Promise<ProviderConnection>
}

export function createEnvDetect(deps: EnvDetectDeps): EnvDetect {
  /** First of a provider's env-var names whose value is a non-empty string. */
  const presentEnvVar = (names: string[] | undefined): string | undefined =>
    names?.find((name) => {
      const value = deps.env[name]
      return typeof value === 'string' && value.trim().length > 0
    })

  const catalog = async (): Promise<ProviderEntry[]> => (await deps.catalogProviders?.()) ?? []

  return {
    listEnvDetectedProviders: async (userId) => {
      const providers = await catalog()
      if (providers.length === 0) return { providers: [] }
      const connected = await deps.connectedProviderIds(userId)
      const out: EnvDetectedProvider[] = []
      for (const p of providers) {
        // A provider with no chat models is not offered anywhere; detecting its key would be the
        // one list that still offered it.
        if (connected.has(p.id) || !providerOffersChat(p)) continue
        const envVar = presentEnvVar(p.env)
        if (!envVar) continue
        out.push({ providerId: p.id, providerName: p.name, envVar })
      }
      return { providers: out }
    },

    connectFromEnv: async (userId, input) => {
      const providers = await catalog()
      const provider = providers.find((p) => p.id === input.providerId)
      const envVar = provider && presentEnvVar(provider.env)
      if (!provider || !envVar) {
        throw new ApiError(
          404,
          'provider_env_key_absent',
          'No API key for this provider was found in the environment',
        )
      }
      return deps.createConnection(userId, {
        providerId: provider.id,
        providerName: provider.name,
        label: `${provider.name} (env)`,
        authType: 'api-key',
        apiKey: (deps.env[envVar] as string).trim(),
      })
    },
  }
}
