import type { ApiKeyAuth, Provider } from '@earendil-works/pi-ai'

import { piProviders } from './providers'

/**
 * Which environment variables hold an API key for each provider — asked of the provider itself.
 *
 * The defect this stops: the catalog's `env` field is what onboarding's "Detected in your
 * environment" reads, and the projection never filled it, so a server started with
 * `ANTHROPIC_API_KEY` set detected nothing. pi keeps these names in two places: each provider's
 * `auth.apiKey.resolve` (what a request actually reads) and a private compatibility table in
 * `env-api-keys.ts` that already disagrees with it (it lists `ANTHROPIC_AUTH_TOKEN`, which the
 * resolver sends as a bearer header, not as a key). A third copy here would drift the same way,
 * so the resolver the request path runs is the one owner, and this module only observes it.
 *
 * Two passes, with neither the network nor the real environment involved:
 *
 *  1. Offer nothing and record every name the resolver asks for — the candidates.
 *  2. Offer each candidate ALONE, and keep it only when the resolver turns exactly that value
 *     into `auth.apiKey` with no companion values. That is the one shape an env-key connection (a
 *     single stored secret) can reproduce, so a bearer header, an ambient source such as
 *     `AWS_PROFILE`, or a key that needs an account id beside it drops out without naming any
 *     provider here.
 *
 * Order is the resolver's own, so the first present name is the one a request would have used.
 */

const PROBE_VALUE = 'localix-env-probe'

async function askedNames(
  auth: ApiKeyAuth,
  offered?: string,
): Promise<{
  asked: string[]
  apiKey: unknown
  companions: boolean
}> {
  const asked: string[] = []
  const result = await auth.resolve({
    ctx: {
      env: async (name) => {
        if (!asked.includes(name)) asked.push(name)
        return name === offered ? PROBE_VALUE : undefined
      },
      fileExists: async () => false,
    },
    signal: new AbortController().signal,
  })
  const env = result?.env
  return {
    asked,
    apiKey: result?.auth.apiKey,
    companions: env !== undefined && Object.keys(env).length > 0,
  }
}

async function apiKeyEnvVarsOf(provider: Provider): Promise<string[]> {
  const auth = provider.auth.apiKey
  if (!auth) return []
  try {
    const { asked } = await askedNames(auth)
    const names: string[] = []
    for (const name of asked) {
      const probe = await askedNames(auth, name)
      if (probe.apiKey === PROBE_VALUE && !probe.companions) names.push(name)
    }
    return names
  } catch {
    // A resolver that throws on an empty context reports nothing — the provider still connects
    // by pasting a key; it just is not offered from the environment.
    return []
  }
}

let envVarsByProvider: Promise<ReadonlyMap<string, readonly string[]>> | undefined

/** Provider id → its API-key env-var names. Provider definitions are frozen, so asked once. */
export function providerApiKeyEnvVars(): Promise<ReadonlyMap<string, readonly string[]>> {
  envVarsByProvider ??= Promise.all(
    piProviders().map(async (provider) => [provider.id, await apiKeyEnvVarsOf(provider)] as const),
  ).then((entries) => new Map(entries.filter(([, names]) => names.length > 0)))
  return envVarsByProvider
}
