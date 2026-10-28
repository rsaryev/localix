import type {
  McpElicitationContent,
  McpElicitationField,
  McpElicitationSchema,
  McpElicitationValue,
} from './mcp-elicitation'

/**
 * One rule for what an elicitation answer may contain, read by both ends: the card checks a field
 * as the person types, and the MCP client checks the answer (the person's or a hook's) before the
 * server sees it. Pure, so the browser bundle can import it.
 */

export interface ElicitationOption {
  value: string
  label: string
}

/** The choices of an enum field (single or multi select), with their display titles. */
export function elicitationOptions(field: McpElicitationField): ElicitationOption[] | null {
  if (field.type === 'array') {
    if (field.items?.anyOf)
      return field.items.anyOf.map((option) => ({ value: option.const, label: option.title }))
    return field.items?.enum ? field.items.enum.map((value) => ({ value, label: value })) : null
  }
  if (field.oneOf)
    return field.oneOf.map((option) => ({ value: option.const, label: option.title }))
  if (field.enum)
    return field.enum.map((value, index) => ({ value, label: field.enumNames?.[index] ?? value }))
  return null
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

function formatError(format: McpElicitationField['format'], value: string): string | null {
  if (format === 'email') return EMAIL.test(value) ? null : 'Enter an email address'
  if (format === 'uri') {
    try {
      new URL(value)
      return null
    } catch {
      return 'Enter a full URL'
    }
  }
  if (format === 'date')
    return DATE.test(value) && !Number.isNaN(Date.parse(value)) ? null : 'Enter a date (YYYY-MM-DD)'
  if (format === 'date-time')
    return value.includes('T') && !Number.isNaN(Date.parse(value))
      ? null
      : 'Enter a date and time (ISO 8601)'
  return null
}

function stringError(field: McpElicitationField, value: unknown): string | null {
  if (typeof value !== 'string') return 'Expected text'
  const options = elicitationOptions(field)
  if (options) return options.some((o) => o.value === value) ? null : 'Choose one of the options'
  if (field.minLength !== undefined && value.length < field.minLength)
    return `At least ${field.minLength} characters`
  if (field.maxLength !== undefined && value.length > field.maxLength)
    return `At most ${field.maxLength} characters`
  return formatError(field.format, value)
}

function numberError(field: McpElicitationField, value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Expected a number'
  if (field.type === 'integer' && !Number.isInteger(value)) return 'Expected a whole number'
  if (field.minimum !== undefined && value < field.minimum) return `At least ${field.minimum}`
  if (field.maximum !== undefined && value > field.maximum) return `At most ${field.maximum}`
  return null
}

function arrayError(field: McpElicitationField, value: unknown): string | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    return 'Expected a list of choices'
  const allowed = new Set((elicitationOptions(field) ?? []).map((o) => o.value))
  if (value.some((item) => !allowed.has(item))) return 'Choose from the options'
  if (new Set(value).size !== value.length) return 'Choose each option once'
  if (field.minItems !== undefined && value.length < field.minItems)
    return `Choose at least ${field.minItems}`
  if (field.maxItems !== undefined && value.length > field.maxItems)
    return `Choose at most ${field.maxItems}`
  return null
}

/** Why `value` does not satisfy `field`, or null when it does. */
export function elicitationFieldError(field: McpElicitationField, value: unknown): string | null {
  switch (field.type) {
    case 'string':
      return stringError(field, value)
    case 'number':
    case 'integer':
      return numberError(field, value)
    case 'boolean':
      return typeof value === 'boolean' ? null : 'Expected yes or no'
    case 'array':
      return arrayError(field, value)
  }
  // A server's field of a type this host does not know.
  return 'Unsupported field'
}

export type ElicitationContentCheck =
  | { ok: true; content: McpElicitationContent }
  | { ok: false; errors: Record<string, string> }

/**
 * Check an accepted answer against the form it answers. Keys the form does not name are dropped,
 * so the server only ever receives its own fields; a missing required field or a value of the
 * wrong shape fails the whole answer.
 */
export function validateElicitationContent(
  schema: McpElicitationSchema | undefined,
  content: unknown,
): ElicitationContentCheck {
  const properties = schema?.properties ?? {}
  const record =
    content && typeof content === 'object' && !Array.isArray(content)
      ? (content as Record<string, unknown>)
      : {}
  const errors: Record<string, string> = {}
  const kept: McpElicitationContent = {}
  for (const name of schema?.required ?? [])
    if (properties[name] && record[name] === undefined) errors[name] = 'Required'
  for (const [name, field] of Object.entries(properties)) {
    const value = record[name]
    if (value === undefined) continue
    const error = elicitationFieldError(field, value)
    if (error) errors[name] = error
    else kept[name] = value as McpElicitationValue
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, content: kept }
}
