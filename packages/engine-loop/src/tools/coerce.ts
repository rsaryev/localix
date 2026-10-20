/**
 * Coerce a model's arguments toward the tool's JSON Schema — only where the value can mean one
 * thing: `"12"` for a number, `"true"` for a boolean, a JSON string for an object or array
 * (several providers stringify nested arguments while sending scalars beside them as real
 * values), `null` on an optional field that does not accept it. The result is checked by the
 * tool's own schema afterwards; coercion decides nothing.
 */
export interface JsonSchema {
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema | JsonSchema[]
  additionalProperties?: boolean | JsonSchema
  allOf?: JsonSchema[]
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  const?: unknown
  enum?: unknown[]
  $ref?: string
}

function typesOf(schema: JsonSchema): string[] {
  if (typeof schema.type === 'string') return [schema.type]
  return Array.isArray(schema.type) ? schema.type.filter((type) => typeof type === 'string') : []
}

function isType(value: unknown, type: string): boolean {
  switch (type) {
    case 'number':
      return typeof value === 'number'
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'string':
      return typeof value === 'string'
    case 'null':
      return value === null
    case 'array':
      return Array.isArray(value)
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    default:
      return false
  }
}

/**
 * Does `value` fit `schema`, as far as types, constants, required keys and closed objects go?
 * Enough to choose a union branch; the tool's Zod schema remains the judge.
 */
export function fitsSchema(value: unknown, schema: JsonSchema): boolean {
  if (schema.const !== undefined && value !== schema.const) return false
  if (schema.enum && !schema.enum.some((option) => option === value)) return false
  if (schema.allOf && !schema.allOf.every((branch) => fitsSchema(value, branch))) return false
  if (schema.anyOf && !schema.anyOf.some((branch) => fitsSchema(value, branch))) return false
  if (schema.oneOf && !schema.oneOf.some((branch) => fitsSchema(value, branch))) return false
  const types = typesOf(schema)
  if (types.length > 0 && !types.some((type) => isType(value, type))) return false
  if (isType(value, 'object') && (schema.properties || schema.additionalProperties === false)) {
    const object = value as Record<string, unknown>
    for (const key of schema.required ?? []) if (!(key in object)) return false
    for (const [key, child] of Object.entries(object)) {
      const property = schema.properties?.[key]
      if (property) {
        if (!fitsSchema(child, property)) return false
      } else if (schema.additionalProperties === false) return false
    }
  }
  if (Array.isArray(value) && schema.items && !Array.isArray(schema.items)) {
    const items = schema.items
    if (!value.every((item) => fitsSchema(item, items))) return false
  }
  return true
}

function coercePrimitive(value: unknown, type: string): unknown {
  switch (type) {
    case 'number':
    case 'integer': {
      if (value === null) return 0
      if (typeof value === 'boolean') return value ? 1 : 0
      if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value)
        if (type === 'integer' ? Number.isInteger(parsed) : Number.isFinite(parsed)) return parsed
      }
      return value
    }
    case 'boolean':
      if (value === null) return false
      if (value === 'true' || value === 1) return true
      if (value === 'false' || value === 0) return false
      return value
    case 'string':
      if (value === null) return ''
      return typeof value === 'number' || typeof value === 'boolean' ? String(value) : value
    case 'null':
      return value === '' || value === 0 || value === false ? null : value
    default:
      return value
  }
}

/** A JSON string where the schema wants an object or array, when it parses into one. */
function parseStructuredString(value: unknown, types: string[]): unknown {
  if (typeof value !== 'string') return value
  if (types.some((type) => isType(value, type))) return value
  if (!types.includes('object') && !types.includes('array')) return value
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return types.some((type) => isType(parsed, type)) ? parsed : value
  } catch {
    return value
  }
}

function coerceUnion(value: unknown, branches: JsonSchema[]): unknown {
  if (branches.some((branch) => fitsSchema(value, branch))) return value
  for (const branch of branches) {
    const candidate = coerceValue(structuredClone(value), branch)
    if (fitsSchema(candidate, branch)) return candidate
  }
  return value
}

/** Does an optional property accept `null` as a value? If not, a `null` there means "absent". */
function acceptsNull(schema: JsonSchema): boolean {
  if (typesOf(schema).includes('null')) return true
  return [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])].some(acceptsNull)
}

function coerceValue(value: unknown, schema: JsonSchema): unknown {
  let next = value
  for (const branch of schema.allOf ?? []) next = coerceValue(next, branch)
  if (schema.anyOf) next = coerceUnion(next, schema.anyOf)
  if (schema.oneOf) next = coerceUnion(next, schema.oneOf)

  const types = typesOf(schema)
  const fitsOne = types.length > 1 && types.some((type) => isType(next, type))
  if (types.length > 0 && !fitsOne) {
    for (const type of types) {
      const candidate = coercePrimitive(next, type)
      if (candidate !== next) {
        next = candidate
        break
      }
    }
  }
  next = parseStructuredString(next, types)

  if (isType(next, 'object') && (types.includes('object') || schema.properties)) {
    const object = { ...(next as Record<string, unknown>) }
    const required = new Set(schema.required ?? [])
    for (const [key, property] of Object.entries(schema.properties ?? {})) {
      if (!(key in object)) continue
      if (object[key] === null && !required.has(key) && !property.$ref && !acceptsNull(property)) {
        delete object[key]
        continue
      }
      object[key] = coerceValue(object[key], property)
    }
    const extra = schema.additionalProperties
    if (extra && typeof extra === 'object') {
      for (const [key, child] of Object.entries(object)) {
        if (!schema.properties?.[key]) object[key] = coerceValue(child, extra)
      }
    }
    next = object
  }
  if (Array.isArray(next) && schema.items) {
    const items = schema.items
    next = next.map((item, index) =>
      Array.isArray(items)
        ? items[index]
          ? coerceValue(item, items[index])
          : item
        : coerceValue(item, items),
    )
  }
  return next
}

/** A coerced copy of `value`; the original is never modified. */
export function coerceToSchema(value: unknown, schema: JsonSchema): unknown {
  return coerceValue(value, schema)
}
