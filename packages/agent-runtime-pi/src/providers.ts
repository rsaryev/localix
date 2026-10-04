import {
  createModels,
  type Api,
  type CreateModelsOptions,
  type Model,
  type Provider,
  type ProviderHeaders,
  type ThinkingLevelMap,
} from '@earendil-works/pi-ai'
import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth'
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

/**
 * Reasoning levels a provider publishes about ITS OWN models, as the catalog metadata pass last
 * read them (`models.ts`). Empty until that pass has run.
 *
 * Read lazily, per `getModels()` call, and deliberately not baked into the provider definition:
 * definitions are built once and frozen, while this arrives from the network — a value copied in
 * at construction would be the stale generated snapshot forever.
 */
let publishedThinkingLevels: ReadonlyMap<string, ThinkingLevelMap> = new Map()

/**
 * Publish what the provider says its models support, overriding the generated snapshot.
 *
 * The snapshot in `vendor/pi` is generated FROM this same field and then frozen at sync time, so
 * it goes stale the moment a vendor changes a model's levels — which is visible to the user as a
 * picker offering a level the model does not have, and missing ones it does. Nothing here knows
 * any model or vendor: whatever the provider publishes wins, and when it publishes nothing the
 * generated data stands.
 */
export function setPublishedThinkingLevels(levels: ReadonlyMap<string, ThinkingLevelMap>): void {
  publishedThinkingLevels = levels
  publishedRevision += 1
}

/**
 * Bumped on every publish, so a derived cache can tell whether it was built from this answer.
 *
 * The catalog projection is memoised and the levels arrive from the network AFTER the first
 * build, so without a revision to key on, the first launch's catalog would carry the generated
 * levels until the process restarted. Same shape as the capability revision in the API: the
 * cheap check is the number, and re-deriving is cheap.
 */
let publishedRevision = 0

export function publishedThinkingRevision(): number {
  return publishedRevision
}

/** A model can reason when some level other than `off` maps to a value the provider accepts. */
export function mapsAnyThinkingLevel(map: ThinkingLevelMap): boolean {
  return Object.entries(map).some(([level, value]) => level !== 'off' && value != null)
}

function withPublishedThinking(model: Model<Api>): Model<Api> {
  const thinkingLevelMap = publishedThinkingLevels.get(model.id)
  if (!thinkingLevelMap) return model
  return { ...model, reasoning: mapsAnyThinkingLevel(thinkingLevelMap), thinkingLevelMap }
}

export function withOpenRouterMetadata(provider: Provider): Provider {
  if (provider.id !== OPENROUTER_PROVIDER_ID) return provider
  return {
    ...provider,
    headers: openRouterRequestHeaders(provider.headers),
    // Both the catalog and the per-request clamp read the model through here, so the published
    // levels reach the picker and the request as ONE answer rather than two that can disagree.
    getModels: () => provider.getModels().map(withPublishedThinking),
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

function getProviderDefinitions(): ReadonlyMap<string, PiProviderDefinition> {
  if (providerDefinitions) return providerDefinitions
  ensureBunOAuthFlows()

  providerDefinitions = new Map(
    builtinProviders().map((provider): [string, PiProviderDefinition] => {
      if (provider.refreshModels === undefined) {
        // Provider definitions contain transport/auth functions and immutable generated
        // model data, but no credential store. Sharing them avoids reconstructing all
        // built-ins for every run while Models itself remains request-scoped.
        return [
          provider.id,
          {
            kind: 'shared',
            provider: freezeProviderDefinition(withOpenRouterMetadata(provider)),
          },
        ]
      }
      if (provider.id !== RADIUS_PROVIDER_ID) {
        throw new Error(`Unsupported stateful built-in pi provider: ${provider.id}`)
      }

      // Radius owns a mutable, dynamically refreshed model list. Reuse the first
      // definition built above, then construct an isolated provider for every later
      // collection so refresh state cannot cross run/tenant boundaries.
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
  return providerDefinitions
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

export function createPiModelsCollection(options?: CreateModelsOptions, providerId?: string) {
  const models = createModels(options)
  if (providerId === undefined) {
    for (const provider of piProviders()) models.setProvider(provider)
  } else {
    const provider = piProvider(providerId)
    if (provider) models.setProvider(provider)
  }
  return models
}
