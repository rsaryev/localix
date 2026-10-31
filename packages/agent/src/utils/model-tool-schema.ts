import { textEncoderByteLength } from './hash'

export const DEFAULT_MODEL_TOOL_SCHEMA_BYTE_BUDGET = 32 * 1024
const MIN_MODEL_TOOL_SCHEMA_BYTE_BUDGET = 64

export type ToolSchemaCompactionStage = 'descriptions' | 'depth' | 'compositions' | 'fallback'

export interface ToolSchemaCompactionDiagnostic {
  reason: 'over_byte_budget'
  originalBytes: number
  finalBytes: number
  budgetBytes: number
  removedDefinitions: string[]
  stages: ToolSchemaCompactionStage[]
}

export interface PreparedModelToolSchema {
  schema: Record<string, unknown>
  bytes: number
  diagnostic?: ToolSchemaCompactionDiagnostic
}

function jsonBytes(value: unknown): number {
  return textEncoderByteLength(JSON.stringify(value))
}

function cloneSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>
}

function definitionRef(ref: string, keyword: '$defs' | 'definitions'): string | undefined {
  const prefix = `#/${keyword}/`
  if (!ref.startsWith(prefix)) return undefined
  const encoded = ref.slice(prefix.length).split('/')[0]
  if (!encoded) return undefined
  return encoded.replace(/~1/g, '/').replace(/~0/g, '~')
}

function collectDefinitionRefs(
  node: unknown,
  keyword: '$defs' | 'definitions',
  out: Set<string>,
): void {
  if (Array.isArray(node)) {
    for (const item of node) collectDefinitionRefs(item, keyword, out)
    return
  }
  if (!node || typeof node !== 'object') return
  const object = node as Record<string, unknown>
  if (typeof object.$ref === 'string') {
    const name = definitionRef(object.$ref, keyword)
    if (name) out.add(name)
  }
  for (const [key, value] of Object.entries(object)) {
    if (key !== '$defs' && key !== 'definitions') collectDefinitionRefs(value, keyword, out)
  }
}

/** Remove definitions that cannot be reached from a local `$ref` in the root schema. */
function pruneUnreachableDefinitions(schema: Record<string, unknown>): string[] {
  const removed: string[] = []
  for (const keyword of ['$defs', 'definitions'] as const) {
    const raw = schema[keyword]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const definitions = raw as Record<string, unknown>
    const reachable = new Set<string>()
    collectDefinitionRefs(schema, keyword, reachable)
    const queue = [...reachable]
    for (let index = 0; index < queue.length; index++) {
      const definition = definitions[queue[index]!]
      if (definition === undefined) continue
      const refs = new Set<string>()
      collectDefinitionRefs(definition, keyword, refs)
      for (const ref of refs) {
        if (reachable.has(ref)) continue
        reachable.add(ref)
        queue.push(ref)
      }
    }
    for (const name of Object.keys(definitions)) {
      if (reachable.has(name)) continue
      delete definitions[name]
      removed.push(`${keyword}/${name}`)
    }
    if (Object.keys(definitions).length === 0) delete schema[keyword]
  }
  return removed.sort()
}

function stripDescriptions(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) stripDescriptions(item)
    return
  }
  if (!node || typeof node !== 'object') return
  const object = node as Record<string, unknown>
  delete object.description
  for (const value of Object.values(object)) stripDescriptions(value)
}

function limitDepth(node: unknown, remaining: number): unknown {
  if (Array.isArray(node)) {
    if (remaining <= 0) return []
    return node.map((item) => limitDepth(item, remaining - 1))
  }
  if (!node || typeof node !== 'object') return node
  if (remaining <= 0) return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    // Keep composition cardinality intact for the later, explicitly ordered
    // composition stage; depth may compact each branch but must not erase the
    // array and silently skip that diagnostic stage.
    if (['anyOf', 'oneOf', 'allOf'].includes(key) && Array.isArray(value)) {
      out[key] = value.map((variant) => limitDepth(variant, remaining - 1))
    } else {
      out[key] = limitDepth(value, remaining - 1)
    }
  }
  return out
}

function simplifyCompositions(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) simplifyCompositions(item)
    return
  }
  if (!node || typeof node !== 'object') return
  const object = node as Record<string, unknown>
  for (const keyword of ['anyOf', 'oneOf', 'allOf'] as const) {
    const variants = object[keyword]
    if (!Array.isArray(variants) || variants.length === 0) continue
    const smallest = [...variants].sort((a, b) => jsonBytes(a) - jsonBytes(b))[0]
    delete object[keyword]
    if (smallest && typeof smallest === 'object' && !Array.isArray(smallest)) {
      Object.assign(object, smallest)
    }
  }
  for (const value of Object.values(object)) simplifyCompositions(value)
}

function shallowObjectFallback(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = schema.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return { type: schema.type ?? 'object' }
  }
  const names = Object.keys(properties)
  const required = Array.isArray(schema.required)
    ? schema.required.filter(
        (name): name is string => typeof name === 'string' && names.includes(name),
      )
    : undefined
  return {
    type: 'object',
    properties: Object.fromEntries(names.map((name) => [name, {}])),
    ...(required?.length ? { required } : {}),
  }
}

/**
 * Produce the JSON schema sent to the model without touching the schema used for
 * runtime validation. Unreachable definitions are always sanitized. Lossy stages
 * run only after the UTF-8 byte budget is exceeded, in a fixed order.
 */
export function prepareModelToolSchema(
  input: Record<string, unknown>,
  options: { budgetBytes?: number } = {},
): PreparedModelToolSchema {
  const budgetBytes = options.budgetBytes ?? DEFAULT_MODEL_TOOL_SCHEMA_BYTE_BUDGET
  if (!Number.isSafeInteger(budgetBytes) || budgetBytes < MIN_MODEL_TOOL_SCHEMA_BYTE_BUDGET) {
    throw new RangeError(
      `model tool schema budget must be an integer >= ${MIN_MODEL_TOOL_SCHEMA_BYTE_BUDGET} bytes`,
    )
  }

  let schema = cloneSchema(input)
  const originalBytes = jsonBytes(schema)
  const removedDefinitions = pruneUnreachableDefinitions(schema)
  let bytes = jsonBytes(schema)
  if (bytes <= budgetBytes) return { schema, bytes }

  const stages: ToolSchemaCompactionStage[] = []
  stripDescriptions(schema)
  stages.push('descriptions')
  bytes = jsonBytes(schema)

  if (bytes > budgetBytes) {
    const source = schema
    for (let depth = 12; depth >= 3 && bytes > budgetBytes; depth--) {
      schema = limitDepth(source, depth) as Record<string, unknown>
      bytes = jsonBytes(schema)
    }
    stages.push('depth')
  }

  if (bytes > budgetBytes) {
    simplifyCompositions(schema)
    stages.push('compositions')
    bytes = jsonBytes(schema)
  }

  if (bytes > budgetBytes) {
    schema = shallowObjectFallback(schema)
    stages.push('fallback')
    bytes = jsonBytes(schema)
  }
  if (bytes > budgetBytes) {
    schema = { type: 'object' }
    bytes = jsonBytes(schema)
  }

  return {
    schema,
    bytes,
    diagnostic: {
      reason: 'over_byte_budget',
      originalBytes,
      finalBytes: bytes,
      budgetBytes,
      removedDefinitions,
      stages,
    },
  }
}
