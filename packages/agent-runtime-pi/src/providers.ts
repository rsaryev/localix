import {
  createModels,
  type AuthContext,
  type CreateModelsOptions,
  type Provider,
  type ProviderHeaders,
} from '@earendil-works/pi-ai'
import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth'
import {
  GeneratedCatalogRefresher,
  withGeneratedCatalogRefresh,
} from '@earendil-works/pi-ai/generated-catalog'
import { builtinProviders, radiusProvider } from '@earendil-works/pi-ai/providers/all'

const OPENROUTER_PROVIDER_ID = 'openrouter'
const RADIUS_PROVIDER_ID = 'radius'

export const OPENROUTER_ATTRIBUTION_HEADERS = {
  'HTTP-Referer': 'https://localix.ai',
  'X-OpenRouter-Title': 'Localix',
  'X-OpenRouter-Categories': 'personal-agent,programming-app',
} as const

function mergeHeaders(
  defaults: ProviderHeaders | undefined,
  overrides?: ProviderHeaders,
): ProviderHeaders {
  const merged: ProviderHeaders = { ...defaults }
  for (const [name, value] of Object.entries(overrides ?? {})) {
    const lowerName = name.toLowerCase()
    for (const existingName of Object.keys(merged)) {
      if (existingName.toLowerCase() === lowerName) delete merged[existingName]
    }
    merged[name] = value
  }
  return merged
}

export function openRouterRequestHeaders(
  overrides?: ProviderHeaders,
  sessionId?: string,
): ProviderHeaders {
  const defaults: ProviderHeaders = { ...OPENROUTER_ATTRIBUTION_HEADERS }
  if (sessionId?.trim()) defaults['x-session-id'] = sessionId.trim().slice(0, 256)
  return mergeHeaders(defaults, overrides)
}

function withHeaders<T extends object>(
  options: T | undefined,
  headers: ProviderHeaders,
): T & {
  headers: ProviderHeaders
} {
  return { ...options, headers } as T & { headers: ProviderHeaders }
}

export function withOpenRouterMetadata(provider: Provider): Provider {
  if (provider.id !== OPENROUTER_PROVIDER_ID) return provider
  return {
    ...provider,
    headers: openRouterRequestHeaders(provider.headers),
    stream(model, context, options) {
      const headers = openRouterRequestHeaders(
        mergeHeaders(provider.headers, options?.headers),
        options?.sessionId,
      )
      return provider.stream(model, context, withHeaders(options, headers))
    },
    streamSimple(model, context, options) {
      const headers = openRouterRequestHeaders(
        mergeHeaders(provider.headers, options?.headers),
        options?.sessionId,
      )
      return provider.streamSimple(model, context, withHeaders(options, headers))
    },
  }
}

function freezeAuthDefinition<T extends Provider>(provider: T): T {
  if (provider.auth.apiKey) Object.freeze(provider.auth.apiKey)
  if (provider.auth.oauth) Object.freeze(provider.auth.oauth)
  Object.freeze(provider.auth)
  return provider
}

function freezeProviderDefinition(provider: Provider): Provider {
  freezeAuthDefinition(provider)
  if (provider.headers) Object.freeze(provider.headers)
  return Object.freeze(provider)
}

type PiProviderDefinition =
  | { kind: 'shared'; provider: Provider }
  | { kind: 'isolated'; id: typeof RADIUS_PROVIDER_ID; create: () => Provider }

let providerDefinitions: ReadonlyMap<string, PiProviderDefinition> | undefined
let oauthFlowsRegistered = false

function ensureBunOAuthFlows(): void {
  if (oauthFlowsRegistered) return
  registerBunOAuthFlows()
  oauthFlowsRegistered = true
}

/**
 * pi's built-in providers, each static one refreshing its generated models from `refresher`.
 *
 * A generated catalog is public data, so its refreshed list is the same for every tenant: the
 * shared definitions carry it to every run's collection. Radius's list is account-specific and
 * stays isolated per collection.
 */
function createPiProviderDefinitions(
  refresher: GeneratedCatalogRefresher,
): ReadonlyMap<string, PiProviderDefinition> {
  ensureBunOAuthFlows()
  return new Map(
    builtinProviders().map((provider): [string, PiProviderDefinition] => {
      if (provider.refreshModels === undefined) {
        // Provider definitions contain transport/auth functions and model data, but no credential
        // store. Sharing them avoids reconstructing all built-ins for every run while Models itself
        // remains request-scoped.
        return [
          provider.id,
          {
            kind: 'shared',
            provider: freezeProviderDefinition(
              withGeneratedCatalogRefresh(withOpenRouterMetadata(provider), refresher),
            ),
          },
        ]
      }
      if (provider.id !== RADIUS_PROVIDER_ID) {
        throw new Error(`Unsupported stateful built-in pi provider: ${provider.id}`)
      }

      // Radius owns a mutable, account-specific model list. Reuse the first definition built
      // above, then construct an isolated provider for every later collection so refresh state
      // cannot cross run/tenant boundaries.
      let first: Provider | undefined = provider
      return [
        provider.id,
        {
          kind: 'isolated',
          id: RADIUS_PROVIDER_ID,
          create() {
            const result = first ?? radiusProvider()
            first = undefined
            return result
          },
        },
      ]
    }),
  )
}

function getProviderDefinitions(): ReadonlyMap<string, PiProviderDefinition> {
  // The process's refresher: one build of the generated catalog serves every provider of a refresh.
  providerDefinitions ??= createPiProviderDefinitions(new GeneratedCatalogRefresher())
  return providerDefinitions
}

/**
 * A separate set of built-ins over its own refresher, sharing no state with `piProviders()`. For
 * tests that drive a refresh from fixture documents.
 */
export function createPiProviders(refresher: GeneratedCatalogRefresher): Provider[] {
  return [...createPiProviderDefinitions(refresher).values()].map(materializeProvider)
}

function materializeProvider(definition: PiProviderDefinition): Provider {
  return definition.kind === 'shared' ? definition.provider : definition.create()
}

function piProvider(providerId: string): Provider | undefined {
  const definition = getProviderDefinitions().get(providerId)
  return definition ? materializeProvider(definition) : undefined
}

export function piProviders(): Provider[] {
  // Pi keeps its Node-only OAuth implementations behind opaque dynamic imports so
  // browser consumers do not bundle them. Localix's production API is itself one
  // Bun bundle, where those relative modules do not exist on disk. Register pi's
  // static Bun loaders at the adapter boundary so both fresh login and stored-token
  // derivation resolve from the bundle without leaking this concern into the API.
  return [...getProviderDefinitions().values()].map(materializeProvider)
}

/**
 * The auth context every Localix collection resolves with: no ambient source at all.
 *
 * pi's default context reads `process.env` and probes credential files (AWS profiles, ADC), so a
 * provider with no stored credential would quietly authenticate with whatever key the server was
 * started with. Localix connects providers only through its own flow, which stores the key in the
 * vault; a request therefore sees the stored credential and nothing else.
 */
export const credentialOnlyAuthContext: AuthContext = {
  env: async () => undefined,
  fileExists: async () => false,
}

export function createPiModelsCollection(options?: CreateModelsOptions, providerId?: string) {
  const models = createModels({ ...options, authContext: credentialOnlyAuthContext })
  if (providerId === undefined) {
    for (const provider of piProviders()) models.setProvider(provider)
  } else {
    const provider = piProvider(providerId)
    if (provider) models.setProvider(provider)
  }
  return models
}
