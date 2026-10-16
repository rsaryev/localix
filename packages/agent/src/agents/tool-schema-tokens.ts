/**
 * The static per-request token cost of a run's tool schemas.
 *
 * Every request pays this before a single conversation token. Estimate the same model-facing
 * payload the runtime builds: name + description + the prepared JSON schema. Descriptor-only
 * callers keep a conservative fallback because they do not expose an input schema.
 *
 * Shared by the loop's max-tokens clamp and the runner's VBC budget. Pure.
 */
import { browserHash, textEncoderByteLength } from '../utils/hash'
import { prepareModelToolSchema } from '../utils/model-tool-schema'
import { zodToJsonSchema } from '../utils/zod-schema'

const estimateTextTokens = (text: string): number => Math.ceil(textEncoderByteLength(text) / 4)

interface EstimableTool {
  name: string
  description?: string
  inputSchema?: { _def?: unknown }
}

// The prepared wire schema is pure for a long-lived Zod schema instance. Cache only its byte
// count so request-budget estimation does not repeatedly clone/compact a large schema.
const preparedSchemaCache = new WeakMap<object, ReturnType<typeof prepareModelToolSchema>>()

function preparedModelSchema(inputSchema: {
  _def?: unknown
}): ReturnType<typeof prepareModelToolSchema> {
  const key = inputSchema as object
  const cached = preparedSchemaCache.get(key)
  if (cached !== undefined) return cached
  const prepared = prepareModelToolSchema(zodToJsonSchema(inputSchema))
  preparedSchemaCache.set(key, prepared)
  return prepared
}

export function estimateToolSchemaTokens(tools: readonly EstimableTool[]): number {
  let total = 0
  for (const tool of tools) {
    if (!tool.inputSchema || typeof tool.inputSchema !== 'object') {
      total += estimateTextTokens(tool.name + (tool.description ?? '')) + 64
      continue
    }

    // Keep the estimate aligned with the provider-neutral function envelope without
    // serializing the full schema a second time. `modelSchemaBytes` is the exact UTF-8
    // size of the prepared JSON object; the prefix accounts for JSON escaping in names
    // and descriptions.
    const prefix = `${JSON.stringify({
      name: tool.name,
      description: tool.description ?? '',
    }).slice(0, -1)},"parameters":`
    const payloadBytes =
      textEncoderByteLength(prefix) + preparedModelSchema(tool.inputSchema).bytes + 1
    total += Math.ceil(payloadBytes / 4)
  }
  return total
}

/** The whole fixed floor: system prompt text + tool schemas. */
export function estimateFixedOverheadTokens(
  systemPrompt: string | undefined,
  tools: readonly EstimableTool[],
): number {
  return estimateTextTokens(systemPrompt ?? '') + estimateToolSchemaTokens(tools)
}

export interface FixedContextDescription {
  tokens: number
  /** The system prompt's share of `tokens`. */
  promptTokens: number
  /** Every tool schema's share of `tokens`. */
  toolTokens: number
  /** The heaviest schemas on the wire, largest first — what to look at when the floor grows. */
  heaviestTools: readonly { name: string; tokens: number }[]
  /** Every tool's share, in registry order. */
  perTool: readonly { name: string; tokens: number }[]
  systemPromptHash: string
  toolSchemaHash: string
}

/** How many of the heaviest tools a description names. */
const HEAVIEST_TOOLS = 5

/**
 * Estimate the fixed request floor and fingerprint the exact prepared schemas in
 * one pass. Callers that need anchor identity must use this instead of running
 * `zodToJsonSchema`/`prepareModelToolSchema` a second time.
 */
export function describeFixedContext(
  systemPrompt: string | undefined,
  tools: readonly EstimableTool[],
): FixedContextDescription {
  let toolTokens = 0
  const perTool: { name: string; tokens: number }[] = []
  const schemas: unknown[] = []
  for (const tool of tools) {
    if (!tool.inputSchema || typeof tool.inputSchema !== 'object') {
      const tokens = estimateTextTokens(tool.name + (tool.description ?? '')) + 64
      toolTokens += tokens
      perTool.push({ name: tool.name, tokens })
      schemas.push({
        name: tool.name,
        description: tool.description ?? '',
        parameters: null,
      })
      continue
    }
    const prepared = preparedModelSchema(tool.inputSchema)
    const prefix = `${JSON.stringify({
      name: tool.name,
      description: tool.description ?? '',
    }).slice(0, -1)},"parameters":`
    const tokens = Math.ceil((textEncoderByteLength(prefix) + prepared.bytes + 1) / 4)
    toolTokens += tokens
    perTool.push({ name: tool.name, tokens })
    schemas.push({
      name: tool.name,
      description: tool.description ?? '',
      parameters: prepared.schema,
    })
  }
  const prompt = systemPrompt ?? ''
  const promptTokens = estimateTextTokens(prompt)
  return {
    tokens: promptTokens + toolTokens,
    promptTokens,
    toolTokens,
    heaviestTools: [...perTool].sort((a, b) => b.tokens - a.tokens).slice(0, HEAVIEST_TOOLS),
    perTool,
    systemPromptHash: browserHash(prompt),
    toolSchemaHash: browserHash(schemas),
  }
}
