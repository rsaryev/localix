import { z } from 'zod'

import { scopeSchema, type Scope } from './contract'

/**
 * What a package lets its person set, as the Store shows it: one field list a provider supplies
 * and one generic form renders (`docs/internals/store.md`, "Configuration"). The provider keeps the
 * storage, the vault and the validation; the form knows no kind.
 */

export const CONFIG_FIELD_TYPES = [
  'string',
  'number',
  'boolean',
  'choice',
  'list',
  'model',
] as const
export const configFieldTypeSchema = z.enum(CONFIG_FIELD_TYPES)

/** What a stored value can be: a list is its items. */
export const configValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])
export type ConfigValue = z.infer<typeof configValueSchema>

export const configFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  help: z.string().optional(),
  type: configFieldTypeSchema,
  required: z.boolean(),
  /** Stored in the vault: the form masks it and never receives its value. */
  secret: z.boolean(),
  /** The values a `choice` takes. */
  options: z
    .array(
      z.object({
        value: z.string(),
        label: z.string().optional(),
        description: z.string().optional(),
      }),
    )
    .optional(),
  min: z.number().optional(),
  max: z.number().optional(),
})
export type ConfigField = z.infer<typeof configFieldSchema>

/** One scope's settings for an installed package. */
export const listingConfigSchema = z.object({
  fields: z.array(configFieldSchema),
  /** Current values by key; null where nothing is stored. A secret's value is never here. */
  values: z.record(z.string(), configValueSchema.nullable()),
  /** The keys of secrets that hold a value. */
  set: z.array(z.string()),
  /** The scope these values are for, and the scopes the package has settings in. */
  scope: scopeSchema,
  scopes: z.array(scopeSchema),
})
export type ListingConfig = z.infer<typeof listingConfigSchema>

/** A declared setting with its current value, the shape plugins and mini apps both keep. */
export interface DeclaredField {
  key: string
  type: string
  title?: string
  description: string
  required: boolean
  secret: boolean
  value: string | number | boolean | null
  isSet: boolean
  multiple?: boolean
  min?: number
  max?: number
  enum?: Array<{ value: string; label?: string; description?: string }>
}

/** A stored list: a JSON array of strings, or what the person typed when it is not one. */
function itemsOf(value: string): string[] {
  try {
    const items: unknown = JSON.parse(value)
    return Array.isArray(items) ? items.map(String) : value ? [value] : []
  } catch {
    return value ? [value] : []
  }
}

function typeOf(field: DeclaredField): ConfigField['type'] {
  if (field.enum && field.enum.length > 0) return 'choice'
  if (field.type === 'boolean') return 'boolean'
  if (field.type === 'number') return 'number'
  if (field.secret) return 'string'
  if (field.multiple) return 'list'
  // A model picker: a provider names such a field by ending its key in `_model`.
  return field.key.endsWith('_model') ? 'model' : 'string'
}

/** A provider's declared settings as the Store's config: typed, secrets only said to be set. */
export function listingConfigFromFields(
  declared: readonly DeclaredField[],
  where: { scope: Scope; scopes: Scope[] },
): ListingConfig {
  const values: ListingConfig['values'] = {}
  const set: string[] = []
  const fields = declared.map((field): ConfigField => {
    const type = typeOf(field)
    if (field.secret) {
      if (field.isSet) set.push(field.key)
    } else {
      values[field.key] =
        field.value === null ? null : type === 'list' ? itemsOf(String(field.value)) : field.value
    }
    return {
      key: field.key,
      label: field.title || field.key,
      ...(field.description ? { help: field.description } : {}),
      type,
      required: field.required,
      secret: field.secret,
      ...(field.enum?.length ? { options: field.enum } : {}),
      ...(field.min !== undefined ? { min: field.min } : {}),
      ...(field.max !== undefined ? { max: field.max } : {}),
    }
  })
  return { fields, values, set, ...where }
}

/** Values as providers store them: a list is a JSON array of strings, the rest as given. */
export function scalarConfigValues(
  values: Record<string, ConfigValue>,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      Array.isArray(value) ? JSON.stringify(value) : value,
    ]),
  )
}
