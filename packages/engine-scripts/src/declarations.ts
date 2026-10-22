/**
 * The tools as TypeScript a model reads before it writes a script: `declare const tools: { … }`,
 * one `name(args: T): Promise<string>` per tool, its description as a doc comment and its JSON
 * Schema as the argument type. Property descriptions and the constraints a type cannot say
 * (`@integer @minimum 1 @default 20`) ride along as line comments.
 */
import type { ScriptTool } from '@localixai/agent/runtime'

type Schema = Record<string, unknown> | boolean
type Declared = Pick<ScriptTool, 'name' | 'description' | 'inputSchema'>

const PLAIN_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const PAD = '  '
/** An argument type longer than this renders as `unknown`, after one try without constraint tags. */
const TYPE_BUDGET = 16_000
/** Local `$ref` expansions per schema, so shared definitions cannot blow up the output. */
const REF_BUDGET = 32
/** Keywords a TypeScript type cannot express, carried as `@keyword value` tags. */
const CONSTRAINTS = [
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
] as const
const TAG_LIMIT = 80
const NEWLINE = /[\r\n\u2028\u2029]/

/** The identifier a script reaches a tool by: `my-tool` is `tools.my_tool` (and `tools["my-tool"]`). */
export function toIdentifier(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9_$]/g, '_')
  return safe === '' || /^[0-9]/.test(safe) ? `_${safe}` : safe
}

export function renderDeclarations(tools: readonly Declared[]): string {
  if (tools.length === 0) return 'declare const tools: {};'
  const body = tools
    .map((tool) => {
      const signature = `${toIdentifier(tool.name)}(args: ${schemaToType(tool.inputSchema)}): Promise<string>;`
      return `${docBlock(tool.description)}${PAD}${signature}`
    })
    .join('\n')
  return `declare const tools: {\n${body}\n};`
}

function docBlock(description: string): string {
  const text = description.trim().replace(/\*\//g, '*\\/')
  const rows = text.split(/\r?\n/)
  if (rows.length === 1) return text ? `${PAD}/** ${text} */\n` : ''
  const inner = rows.map((row) => (row ? `${PAD} * ${row}` : `${PAD} *`))
  return [`${PAD}/**`, ...inner, `${PAD} */`].join('\n') + '\n'
}

export function schemaToType(schema: Schema): string {
  for (const withTags of [true, false]) {
    const rendered = new SchemaPrinter(schema, withTags).print(schema)
    if (rendered.length <= TYPE_BUDGET) return rendered
  }
  return 'unknown'
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asList = (value: unknown): unknown[] | undefined => (Array.isArray(value) ? value : undefined)

/** `a | b` from parts, duplicates dropped; anything unknown makes the whole union unknown. */
function joinUnion(parts: readonly string[]): string {
  if (parts.length === 0) return 'never'
  const distinct = Array.from(new Set(parts))
  return distinct.includes('unknown') ? 'unknown' : distinct.join(' | ')
}

const literal = (value: unknown) => JSON.stringify(value) ?? 'unknown'

/** One schema's rendering: the root its `$ref`s resolve against and how many it has expanded. */
class SchemaPrinter {
  private readonly open: string[] = []
  private refsLeft = REF_BUDGET

  constructor(
    private readonly root: Schema,
    private readonly withTags: boolean,
  ) {}

  print(schema: unknown): string {
    if (schema === true) return 'unknown'
    if (schema === false) return 'never'
    if (!isObject(schema)) return 'unknown'
    if (typeof schema.$ref === 'string') return this.reference(schema.$ref)
    if ('const' in schema) return literal(schema.const)
    const choices = asList(schema.enum)
    if (choices) return joinUnion(choices.map(literal))
    const variants = asList(schema.anyOf) ?? asList(schema.oneOf)
    if (variants) return joinUnion(variants.map((variant) => this.print(variant)))
    const all = asList(schema.allOf)
    if (all) return this.intersection(all)
    const type = schema.type
    if (Array.isArray(type))
      return joinUnion(type.map((one) => this.print({ ...schema, type: one })))
    return this.byType(type, schema)
  }

  private byType(type: unknown, schema: Record<string, unknown>): string {
    switch (type) {
      case 'string':
      case 'boolean':
      case 'null':
        return type
      case 'number':
      case 'integer':
        return 'number'
      case 'array':
        return this.array(schema)
      case 'object':
        return this.object(schema)
      case undefined:
        if ('properties' in schema || 'additionalProperties' in schema) return this.object(schema)
        if ('items' in schema || 'prefixItems' in schema) return this.array(schema)
        return 'unknown'
      default:
        return 'unknown'
    }
  }

  /** A `#/…` pointer into the root, expanded while it is not already being expanded. */
  private reference(pointer: string): string {
    if (this.refsLeft <= 0 || this.open.includes(pointer)) return 'unknown'
    const target = lookup(this.root, pointer)
    if (target === undefined) return 'unknown'
    this.refsLeft -= 1
    this.open.push(pointer)
    try {
      return this.print(target)
    } finally {
      this.open.pop()
    }
  }

  private intersection(parts: readonly unknown[]): string {
    const known = parts.map((part) => this.print(part)).filter((part) => part !== 'unknown')
    if (known.length === 0) return 'unknown'
    return known.map((part) => (part.includes(' | ') ? `(${part})` : part)).join(' & ')
  }

  private array(schema: Record<string, unknown>): string {
    const { items, prefixItems } = schema
    if (items !== undefined && !Array.isArray(items)) return `Array<${this.print(items)}>`
    const positions = asList(prefixItems) ?? asList(items) ?? []
    if (positions.length === 0) return 'unknown[]'
    return `[${positions.map((item) => this.print(item)).join(', ')}]`
  }

  private object(schema: Record<string, unknown>): string {
    const properties = isObject(schema.properties) ? schema.properties : {}
    const required = new Set(asList(schema.required) ?? [])
    const fields = Object.entries(properties).map(([key, property]) => ({
      member: `${PLAIN_KEY.test(key) ? key : JSON.stringify(key)}${required.has(key) ? '' : '?'}: ${this.print(property)};`,
      notes: this.notes(property),
    }))
    const extra = schema.additionalProperties
    const index =
      extra === undefined
        ? fields.length === 0
          ? '[key: string]: unknown;'
          : undefined
        : extra === false
          ? undefined
          : `[key: string]: ${extra === true ? 'unknown' : this.print(extra)};`
    const members = [...fields.map((field) => field.member), ...(index ? [index] : [])]
    if (members.length === 0) return '{}'
    if (fields.every((field) => field.notes.length === 0)) return `{ ${members.join(' ')} }`
    const rows: string[] = []
    for (const [position, member] of members.entries()) {
      for (const note of fields[position]?.notes ?? []) rows.push(`${PAD}// ${note}`)
      rows.push(PAD + member.replace(/\n/g, `\n${PAD}`))
    }
    return ['{', ...rows, '}'].join('\n')
  }

  /** The property's description lines, then its constraint tags. */
  private notes(property: unknown): string[] {
    if (!isObject(property)) return []
    const said = typeof property.description === 'string' ? property.description : ''
    const lines = said
      .split(NEWLINE)
      .map((line) => line.trim())
      .filter((line) => line !== '')
    const tags = this.withTags ? constraintTags(property) : ''
    return tags ? [...lines, tags] : lines
  }
}

/** Resolves a local JSON Pointer (`#`, `#/$defs/x`); anything else is not followed. */
function lookup(root: Schema, pointer: string): Schema | undefined {
  if (pointer !== '#' && !pointer.startsWith('#/')) return undefined
  let node: unknown = root
  for (const token of pointer.slice(2).split('/')) {
    if (token === '') continue
    const key = decodeURIComponent(token).replace(/~1/g, '/').replace(/~0/g, '~')
    if (!isObject(node) || !Object.prototype.hasOwnProperty.call(node, key)) return undefined
    node = node[key]
  }
  return node === true || node === false || isObject(node) ? node : undefined
}

/** What a property's type cannot say. An optional's constraints live in its one non-null branch. */
function constraintTags(property: Record<string, unknown>): string {
  const branches = asList(property.anyOf) ?? asList(property.oneOf) ?? []
  const nonNull = branches.filter((branch) => !isObject(branch) || branch.type !== 'null')
  const sources = nonNull.length === 1 && isObject(nonNull[0]) ? [property, nonNull[0]] : [property]
  const tags = sources.some((source) => source.type === 'integer') ? ['@integer'] : []
  for (const keyword of CONSTRAINTS) {
    const values = new Set(sources.map((source) => source[keyword]))
    for (const value of values) {
      if (typeof value === 'string' || typeof value === 'number') tags.push(`@${keyword} ${value}`)
    }
  }
  if (property.default != null) tags.push(`@default ${JSON.stringify(property.default)}`)
  if (property.deprecated === true) tags.push('@deprecated')
  return tags.filter((tag) => tag.length <= TAG_LIMIT && !NEWLINE.test(tag)).join(' ')
}
