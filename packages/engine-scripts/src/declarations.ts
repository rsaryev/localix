/**
 * The tools as TypeScript a model reads before it writes a script: `declare const tools: { … }`,
 * one `name(args: T): Promise<string>` per tool, its description as a doc comment and its JSON
 * Schema as the argument type. Property descriptions and the constraints a type cannot say
 * (`@integer @minimum 1 @default 20`) ride along as line comments.
 */
import type { ScriptTool } from '@localixai/agent/runtime'

type Schema = Record<string, unknown> | boolean
type Declared = Pick<ScriptTool, 'name' | 'description' | 'inputSchema'>

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const INDENT = '  '
/** An argument type longer than this renders as `unknown`, after one try without constraint tags. */
const MAX_TYPE_CHARS = 16_000
/** Local `$ref` expansions per schema, so shared definitions cannot blow up the output. */
const MAX_REF_EXPANSIONS = 32
const TAG_KEYWORDS = [
  'minimum',
  'exclusiveMinimum',
  'maximum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minItems',
  'maxItems',
]
const MAX_TAG_CHARS = 80
const LINE_BREAKS = /[\r\n\u2028\u2029]/

/** The identifier a script reaches a tool by: `my-tool` is `tools.my_tool` (and `tools["my-tool"]`). */
export function toIdentifier(name: string): string {
  const identifier = name.replace(/[^A-Za-z0-9_$]/g, '_')
  return identifier === '' || /^[0-9]/.test(identifier) ? `_${identifier}` : identifier
}

export function renderDeclarations(tools: readonly Declared[]): string {
  if (tools.length === 0) return 'declare const tools: {};'
  const members = tools.map(
    (tool) =>
      `${docComment(tool.description)}${INDENT}${toIdentifier(tool.name)}(args: ${schemaToType(tool.inputSchema)}): Promise<string>;`,
  )
  return `declare const tools: {\n${members.join('\n')}\n};`
}

function docComment(description: string): string {
  const lines = description.trim().replace(/\*\//g, '*\\/').split(/\r?\n/)
  if (lines.length === 1) return lines[0] ? `${INDENT}/** ${lines[0]} */\n` : ''
  return `${INDENT}/**\n${lines.map((line) => `${INDENT} *${line ? ` ${line}` : ''}`).join('\n')}\n${INDENT} */\n`
}

interface Context {
  root: Schema
  resolving: Set<string>
  expansions: number
  tags: boolean
}

export function schemaToType(schema: Schema): string {
  const render = (tags: boolean) =>
    toType(schema, { root: schema, resolving: new Set(), expansions: 0, tags })
  const tagged = render(true)
  if (tagged.length <= MAX_TYPE_CHARS) return tagged
  const plain = render(false)
  return plain.length <= MAX_TYPE_CHARS ? plain : 'unknown'
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function resolveRef(ref: string, root: Schema): Schema | undefined {
  if (ref !== '#' && !ref.startsWith('#/')) return undefined
  let current: unknown = root
  for (const segment of ref.slice(2).split('/').filter(Boolean)) {
    const key = decodeURIComponent(segment).replace(/~1/g, '/').replace(/~0/g, '~')
    if (!isRecord(current) || !(key in current)) return undefined
    current = current[key]
  }
  return typeof current === 'boolean' || isRecord(current) ? current : undefined
}

function union(types: string[]): string {
  const unique = [...new Set(types)]
  if (unique.includes('unknown')) return 'unknown'
  return unique.length === 0 ? 'never' : unique.join(' | ')
}

function toType(schema: Schema, context: Context): string {
  if (schema === true) return 'unknown'
  if (schema === false) return 'never'
  if (!isRecord(schema)) return 'unknown'
  if (typeof schema.$ref === 'string') {
    const ref = schema.$ref
    const target =
      context.resolving.has(ref) || context.expansions >= MAX_REF_EXPANSIONS
        ? undefined
        : resolveRef(ref, context.root)
    if (target === undefined) return 'unknown'
    context.expansions++
    context.resolving.add(ref)
    try {
      return toType(target, context)
    } finally {
      context.resolving.delete(ref)
    }
  }
  if ('const' in schema) return JSON.stringify(schema.const) ?? 'unknown'
  if (Array.isArray(schema.enum))
    return union(schema.enum.map((value) => JSON.stringify(value) ?? 'unknown'))
  const variants = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : undefined
  if (variants) return union(variants.map((variant) => toType(variant as Schema, context)))
  if (Array.isArray(schema.allOf)) {
    const parts = schema.allOf
      .map((part) => toType(part as Schema, context))
      .filter((part) => part !== 'unknown')
    return parts.length === 0
      ? 'unknown'
      : parts.map((part) => (part.includes(' | ') ? `(${part})` : part)).join(' & ')
  }
  const type = schema.type
  if (Array.isArray(type))
    return union(type.map((entry) => toType({ ...schema, type: entry }, context)))
  switch (type) {
    case 'string':
      return 'string'
    case 'number':
    case 'integer':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'null':
      return 'null'
    case 'array':
      return arrayType(schema, context)
    case 'object':
      return objectType(schema, context)
    case undefined:
      if ('properties' in schema || 'additionalProperties' in schema)
        return objectType(schema, context)
      if ('items' in schema || 'prefixItems' in schema) return arrayType(schema, context)
      return 'unknown'
    default:
      return 'unknown'
  }
}

function arrayType(schema: Record<string, unknown>, context: Context): string {
  if (schema.items !== undefined && !Array.isArray(schema.items))
    return `Array<${toType(schema.items as Schema, context)}>`
  const tuple = Array.isArray(schema.prefixItems)
    ? schema.prefixItems
    : Array.isArray(schema.items)
      ? schema.items
      : []
  return tuple.length > 0
    ? `[${tuple.map((item) => toType(item as Schema, context)).join(', ')}]`
    : 'unknown[]'
}

/** What a property's type cannot say. An optional's constraints live in its one non-null branch. */
function constraintTags(property: unknown): string {
  if (!isRecord(property)) return ''
  const variants = Array.isArray(property.anyOf) ? property.anyOf : property.oneOf
  const nonNull = Array.isArray(variants)
    ? variants.filter((variant) => !isRecord(variant) || variant.type !== 'null')
    : []
  const schemas = nonNull.length === 1 && isRecord(nonNull[0]) ? [property, nonNull[0]] : [property]
  const tags: string[] = []
  if (schemas.some((schema) => schema.type === 'integer')) tags.push('@integer')
  for (const keyword of TAG_KEYWORDS) {
    for (const value of new Set(schemas.map((schema) => schema[keyword]))) {
      if (typeof value === 'number' || typeof value === 'string') tags.push(`@${keyword} ${value}`)
    }
  }
  if (property.default !== undefined && property.default !== null)
    tags.push(`@default ${JSON.stringify(property.default)}`)
  if (property.deprecated === true) tags.push('@deprecated')
  return tags.filter((tag) => tag.length <= MAX_TAG_CHARS && !LINE_BREAKS.test(tag)).join(' ')
}

function objectType(schema: Record<string, unknown>, context: Context): string {
  const properties = isRecord(schema.properties) ? schema.properties : {}
  const required = new Set(Array.isArray(schema.required) ? schema.required : [])
  const names = Object.keys(properties)
  const members = names.map(
    (name) =>
      `${IDENTIFIER.test(name) ? name : JSON.stringify(name)}${required.has(name) ? '' : '?'}: ${toType(properties[name] as Schema, context)};`,
  )
  const additional = schema.additionalProperties
  if (additional !== undefined && additional !== false) {
    members.push(
      `[key: string]: ${additional === true ? 'unknown' : toType(additional as Schema, context)};`,
    )
  } else if (additional === undefined && names.length === 0) {
    members.push('[key: string]: unknown;')
  }
  if (members.length === 0) return '{}'
  const comments = names.map((name) => {
    const property = properties[name]
    const description =
      isRecord(property) && typeof property.description === 'string' ? property.description : ''
    const lines = description
      .split(LINE_BREAKS)
      .map((line) => line.trim())
      .filter(Boolean)
    const tags = context.tags ? constraintTags(property) : ''
    return tags ? [...lines, tags] : lines
  })
  if (!comments.some((comment) => comment.length > 0)) return `{ ${members.join(' ')} }`
  const lines = ['{']
  members.forEach((member, index) => {
    for (const line of comments[index] ?? []) lines.push(`${INDENT}// ${line}`)
    lines.push(`${INDENT}${member.replace(/\n/g, `\n${INDENT}`)}`)
  })
  lines.push('}')
  return lines.join('\n')
}
