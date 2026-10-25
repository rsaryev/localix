import { z } from 'zod'

import { listingRefSchema, scopeSchema, type Scope } from './contract'

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
  /** Name and value pairs: a server's environment or headers. */
  'map',
  /** Any of the field's `options`, as a list of their values. */
  'multichoice',
] as const
export const configFieldTypeSchema = z.enum(CONFIG_FIELD_TYPES)

/** What a stored value can be: a list is its items, a map its name and value pairs. */
export const configValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.record(z.string(), z.string()),
])
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
  /** A `string` written over several lines: the form gives it a text area. */
  multiline: z.boolean().optional(),
})
export type ConfigField = z.infer<typeof configFieldSchema>

/** A button on an item's Settings tab that does something other than save: Test connection. */
export const itemActionSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  help: z.string().optional(),
  /** Drawn as a destructive choice. */
  danger: z.boolean().optional(),
})
export type ItemAction = z.infer<typeof itemActionSchema>

/** What running an action says: shown beside the buttons; `open` is an address to open. */
export const actionResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  open: z
    .string()
    .refine((address) => /^https?:\/\//u.test(address), 'Only a web address opens')
    .optional(),
})
export type ActionResult = z.infer<typeof actionResultSchema>

/**
 * What a shelf-level action would change, shown before the person confirms: each item with the
 * reason it is in it (`docs/internals/store.md`, "Shelf actions"). An empty list is "nothing to do".
 */
export const shelfPlanSchema = z.object({
  /** One line for the dialog: what confirming does. */
  summary: z.string(),
  items: z.array(z.object({ ref: listingRefSchema, name: z.string(), reason: z.string() })),
})
export type ShelfPlan = z.infer<typeof shelfPlanSchema>

/** What making a new item asks for: the fields of its form, and where it can be kept. */
export const createFormSchema = z.object({
  fields: z.array(configFieldSchema),
  scopes: z.array(scopeSchema).min(1),
  /** A noun for the button and dialog: "MCP server". */
  noun: z.string(),
})
export type CreateForm = z.infer<typeof createFormSchema>

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
  /** What else can be done with it, by `runAction`; absent: nothing. */
  actions: z.array(itemActionSchema).optional(),
  /**
   * Which version of the stored settings these values are. A form sends it back as the reserved
   * value `_revision` when it saves; a provider whose settings changed meanwhile refuses with a
   * conflict, so an edit made elsewhere is never silently overwritten.
   */
  revision: z.string().optional(),
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

/** Values as providers store them: a list is a JSON array of strings, a map a JSON object, the rest as given. */
export function scalarConfigValues(
  values: Record<string, ConfigValue>,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      typeof value === 'object' ? JSON.stringify(value) : value,
    ]),
  )
}
