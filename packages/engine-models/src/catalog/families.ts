/**
 * HOW A MODEL IS SERVED: which provider SDK speaks its wire, where it lives, how a person signs in.
 *
 * models.dev names an npm package per provider and, where one model is served differently, per
 * model (Copilot serves Claude through the Anthropic wire and GPT through Responses). Ten packages
 * are served directly, the three clouds (Bedrock, Azure, Vertex) among them; packages that are a
 * thin wrapper over the OpenAI-compatible wire are served through that wire at their known
 * address, so no dependency is added for what a base URL says.
 */

import { templateNames } from './settings'

/** The provider SDKs this engine speaks. */
export type ProviderFamily =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'openrouter'
  | 'gateway'
  | 'openai-compatible'
  | 'bedrock'
  | 'azure'
  | 'vertex'
  | 'vertex-anthropic'

/** One model's way to its provider: the SDK, the address, and for OpenAI which of its APIs. */
export interface Route {
  family: ProviderFamily
  baseURL?: string
  /** OpenAI's (and Azure's) two APIs: Responses (the default) or Chat Completions. */
  shape?: 'responses' | 'completions'
}

/** A sign-in other than an API key. */
export interface OAuthLogin {
  /** Which flow (`auth/flows`). */
  flow: 'openai-chatgpt' | 'openai-codex' | 'openrouter' | 'github-copilot'
  name: string
  loginLabel: string
  /** Paid through a subscription rather than per token: costs are an API-equivalent estimate. */
  subscription: boolean
}

const PACKAGE_FAMILY: Readonly<Record<string, ProviderFamily>> = {
  '@ai-sdk/openai': 'openai',
  '@ai-sdk/anthropic': 'anthropic',
  '@ai-sdk/google': 'google',
  '@openrouter/ai-sdk-provider': 'openrouter',
  '@ai-sdk/gateway': 'gateway',
  '@ai-sdk/openai-compatible': 'openai-compatible',
  '@ai-sdk/amazon-bedrock': 'bedrock',
  '@ai-sdk/azure': 'azure',
  '@ai-sdk/google-vertex': 'vertex',
  '@ai-sdk/google-vertex/anthropic': 'vertex-anthropic',
}

/** Packages of their own whose API is the OpenAI-compatible wire at this address. */
const COMPATIBLE_ADDRESS: Readonly<Record<string, string>> = {
  '@ai-sdk/groq': 'https://api.groq.com/openai/v1',
  '@ai-sdk/cerebras': 'https://api.cerebras.ai/v1',
  '@ai-sdk/togetherai': 'https://api.together.xyz/v1',
  '@ai-sdk/deepinfra': 'https://api.deepinfra.com/v1/openai',
  '@ai-sdk/mistral': 'https://api.mistral.ai/v1',
  '@ai-sdk/xai': 'https://api.x.ai/v1',
}

/**
 * The route for a package and address, or undefined when this engine cannot serve it: an SDK it
 * does not carry, an address naming a variable the connection cannot set (`settable`: its
 * provider's settings, filled per request), or a compatible wire with no address at all.
 */
export function routeOf(
  npm: string,
  api: string | undefined,
  shape?: Route['shape'],
  settable: readonly string[] = [],
): Route | undefined {
  if (api && templateNames(api).some((name) => !settable.includes(name))) return undefined
  const compatible = COMPATIBLE_ADDRESS[npm]
  if (compatible) return { family: 'openai-compatible', baseURL: api ?? compatible }
  const family = PACKAGE_FAMILY[npm]
  if (!family || (family === 'openai-compatible' && !api)) return undefined
  return {
    family,
    ...(api ? { baseURL: api } : {}),
    ...((family === 'openai' || family === 'azure') && shape ? { shape } : {}),
  }
}

/** The wire a model is served over, as the catalog detail panel names it. */
export function wireOf(route: Route): string {
  switch (route.family) {
    case 'openai':
    case 'azure':
      return route.shape === 'completions' ? 'openai-completions' : 'openai-responses'
    case 'anthropic':
    case 'vertex-anthropic':
      return 'anthropic-messages'
    case 'google':
    case 'vertex':
      return 'google-generative-ai'
    case 'bedrock':
      return 'bedrock-converse'
    case 'gateway':
      return 'ai-gateway'
    case 'openrouter':
    case 'openai-compatible':
      return 'openai-completions'
  }
}

/** The providers whose SDK has a decision model (`decisionModel` / `evaluationModel`). */
export const DECISION_FAMILIES: ReadonlySet<ProviderFamily> = new Set([
  'openai',
  'openrouter',
  'gateway',
])

export const OAUTH_LOGINS: Readonly<Record<string, OAuthLogin>> = {
  openai: {
    flow: 'openai-chatgpt',
    name: 'OpenAI (ChatGPT subscription)',
    loginLabel: 'Sign in with ChatGPT',
    subscription: true,
  },
  'openai-codex': {
    flow: 'openai-codex',
    name: 'ChatGPT Plus/Pro (Codex)',
    loginLabel: 'Sign in with ChatGPT',
    subscription: true,
  },
  openrouter: {
    flow: 'openrouter',
    name: 'OpenRouter',
    loginLabel: 'Sign in with OpenRouter',
    subscription: false,
  },
  'github-copilot': {
    flow: 'github-copilot',
    name: 'GitHub Copilot',
    loginLabel: 'Sign in with GitHub',
    subscription: true,
  },
}
