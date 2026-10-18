/**
 * Whose models the catalog lists before a search: the labs' own models — not fine-tunes or
 * merges — as GGUF from the lab itself or from a converter that publishes quantizations, not
 * variants. Anything else is a search away.
 */
import { originalOf } from './hf-catalog'
import type { HfModel } from './hf-client'

/** Labs that train the models. */
export const LABS: ReadonlySet<string> = new Set([
  'Qwen',
  'deepseek-ai',
  'meta-llama',
  'google',
  'openai',
  'mistralai',
  'microsoft',
  'nvidia',
  'ibm-granite',
  'LiquidAI',
  'HuggingFaceTB',
  'zai-org',
  'THUDM',
  'moonshotai',
  'MiniMaxAI',
  'XiaomiMiMo',
  'OpenGVLab',
  'tencent',
  'baidu',
  'stepfun-ai',
  'openbmb',
  'allenai',
  'tiiuae',
  'CohereLabs',
  'inclusionAI',
  'ByteDance-Seed',
  'swiss-ai',
  'ai21labs',
])

/** Publishers of quantizations, most trusted first: the llama.cpp project, then the rest. */
export const CONVERTERS = ['ggml-org', 'unsloth', 'lmstudio-community', 'bartowski'] as const

const ownerOf = (repo: string) => repo.split('/')[0] ?? ''

/** How much a publisher's build is preferred: the lab's own first, then by converter. */
function preference(row: HfModel): number {
  const publisher = ownerOf(row.id)
  if (LABS.has(publisher)) return 0
  const converter = CONVERTERS.indexOf(publisher as (typeof CONVERTERS)[number])
  return converter < 0 ? Number.POSITIVE_INFINITY : converter + 1
}

/**
 * A lab's model: published by the lab, or by a converter naming a lab's model as its original.
 * A converter's repository that names no original is not known to be one.
 */
export function isOriginalModel(row: Pick<HfModel, 'id' | 'cardData'>): boolean {
  const publisher = ownerOf(row.id)
  const original = originalOf(row)
  if (LABS.has(publisher)) return !original || LABS.has(ownerOf(original))
  return (
    preference(row as HfModel) < Number.POSITIVE_INFINITY &&
    !!original &&
    LABS.has(ownerOf(original))
  )
}

/** One original model, whoever converted it (Google's QAT original included). */
export const originalKey = (row: Pick<HfModel, 'id' | 'cardData'>) =>
  (originalOf(row) ?? row.id).toLowerCase().replace(/-(qat|unquantized|q4_0|gguf)(?=-|$)/g, '')

/** How much a repository's publisher is preferred: lower first. */
export const publisherRank = (repo: string) => preference({ id: repo } as HfModel)
