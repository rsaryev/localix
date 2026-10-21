/**
 * HOW THE CATALOG IS LISTED: the host's `local` provider made a served provider, and each provider
 * as the picker shows it — with the label its key field takes where that is not a plain API key.
 */
import type { CatalogProvider } from '@localixai/agent/catalog'
import type { LocalProviderHost } from '@localixai/agent/runtime'
import { LOCAL_PROVIDER_ID } from '@localixai/agent/runtime'

import { OAUTH_LOGINS, type Route } from './families'
import type { ServedModel, ServedProvider } from './normalize'

export function localProvider(host: LocalProviderHost): ServedProvider {
  const route: Route = { family: 'openai-compatible', baseURL: 'http://127.0.0.1/v1' }
  const chat: Record<string, ServedModel> = {}
  for (const model of host.models()) {
    chat[model.id] = {
      id: model.id,
      name: model.name,
      route,
      input: model.vision ? ['text', 'image'] : ['text'],
      output: ['text'],
      attachment: model.vision,
      tools: true,
      reasons: model.reasoning,
      reasoning: model.reasoning ? ['off', 'low', 'medium', 'high'] : [],
      temperature: true,
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxTokens,
      cost: { input: 0, output: 0 },
    }
  }
  return { id: LOCAL_PROVIDER_ID, name: 'Local', env: [], settings: [], route, chat, decision: {} }
}

/** What the key field asks for where it is not a plain API key. */
const KEY_LABEL: Partial<Record<Route['family'], string>> = {
  bedrock: 'Bedrock API key',
  vertex: 'Service account key (JSON) or Vertex API key',
  'vertex-anthropic': 'Service account key (JSON)',
}

export function listedProvider(provider: ServedProvider): CatalogProvider {
  const keyLabel = KEY_LABEL[provider.route.family]
  return {
    id: provider.id,
    name: provider.name,
    modelCount: Object.keys(provider.chat).length,
    authType: OAUTH_LOGINS[provider.id] && provider.env.length === 0 ? 'oauth-pkce' : 'api-key',
    ...(provider.route.baseURL ? { apiBaseUrl: provider.route.baseURL } : {}),
    ...(provider.doc ? { doc: provider.doc } : {}),
    ...(provider.settings.length > 0
      ? { settings: provider.settings.map((setting) => ({ ...setting })) }
      : {}),
    ...(keyLabel ? { keyLabel } : {}),
  }
}
