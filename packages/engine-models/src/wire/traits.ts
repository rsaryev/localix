/**
 * WHAT A REQUEST MUST KNOW ABOUT ITS MODEL beyond its provider family: whether it reads images,
 * whether its wire is the OpenAI-compatible one, which tool-call ids it accepts, and which prompt
 * cache breakpoints it reads. Read off the catalog entry the run is bound to.
 */
import type { CatalogEntry } from '../catalog/catalog'
import type { WireProfile } from './prompt'

type Traits = Pick<WireProfile, 'images' | 'compatible' | 'toolCallIds' | 'cachePoints'> &
  Partial<Pick<WireProfile, 'cacheBreakpoints'>>

const isClaude = (modelId: string) => /claude/iu.test(modelId)

function isMistral(entry: CatalogEntry): boolean {
  return entry.provider.id === 'mistral' || (entry.route.baseURL ?? '').includes('api.mistral.ai')
}

export function wireTraits(entry: CatalogEntry): Traits {
  const family = entry.route.family
  const traits: Traits = {
    images: entry.model.input.includes('image'),
    ...(family === 'openai-compatible' ? { compatible: true } : {}),
  }
  if (family === 'anthropic' || family === 'vertex-anthropic' || family === 'bedrock')
    traits.toolCallIds = 'anthropic'
  else if (family === 'openai-compatible' && isMistral(entry)) traits.toolCallIds = 'mistral'
  // Claude reads only the cache breakpoints it is given, on Bedrock as everywhere: there they
  // are Bedrock's own cache points. Through the gateway, Anthropic's breakpoints pass through.
  if (family === 'bedrock' && isClaude(entry.model.id)) {
    traits.cacheBreakpoints = true
    traits.cachePoints = 'bedrock'
  } else if (family === 'gateway' && entry.model.id.startsWith('anthropic/')) {
    traits.cacheBreakpoints = true
    traits.cachePoints = 'anthropic'
  }
  return traits
}
