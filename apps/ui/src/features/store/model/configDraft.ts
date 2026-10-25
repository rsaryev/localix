import type { ConfigField, ConfigValue, ListingConfig } from '@localixai/store'

/**
 * What the person has typed into a configuration form, apart from what is saved. A field's draft
 * is text, a switch's state or a list's lines; a number is text until it is saved, so a half-typed
 * "1." is not an error. A secret's draft is empty until the person replaces it.
 */
export type DraftValue = string | boolean | string[]
export type ConfigDraft = Record<string, DraftValue>

/** The empty draft of a field: what a field with nothing stored starts as. */
const blank = (field: ConfigField): DraftValue =>
  field.type === 'boolean' ? false : field.type === 'list' ? [] : ''

function draftOf(field: ConfigField, saved: ConfigValue | null | undefined): DraftValue {
  if (field.secret || saved === null || saved === undefined) return blank(field)
  return typeof saved === 'number' ? String(saved) : saved
}

/** The draft a form opens with: the saved values, secrets blank. */
export function openingDraft(config: ListingConfig): ConfigDraft {
  return Object.fromEntries(
    config.fields.map((field) => [field.key, draftOf(field, config.values[field.key])]),
  )
}

const same = (a: DraftValue, b: DraftValue) =>
  Array.isArray(a) && Array.isArray(b) ? a.join('\n') === b.join('\n') : a === b

/** The keys whose draft differs from what is saved. */
export function changedKeys(config: ListingConfig, draft: ConfigDraft): string[] {
  const opening = openingDraft(config)
  return config.fields
    .filter((f) => !same(draft[f.key] ?? blank(f), opening[f.key]!))
    .map((f) => f.key)
}

/** What a field's draft is not allowed to be, in one sentence; absent when it is fine. */
function problemOf(field: ConfigField, value: DraftValue, held: boolean): string | undefined {
  const empty = Array.isArray(value) ? value.length === 0 : value === ''
  if (empty) return field.required && !held ? `${field.label} is required` : undefined
  if (field.type !== 'number') return undefined
  const number = Number(value)
  if (Number.isNaN(number)) return `${field.label} must be a number`
  if (field.min !== undefined && number < field.min)
    return `${field.label} must be at least ${field.min}`
  if (field.max !== undefined && number > field.max)
    return `${field.label} must be at most ${field.max}`
  return undefined
}

/** A problem per key whose draft cannot be saved. A secret already set may stay empty. */
export function draftProblems(config: ListingConfig, draft: ConfigDraft): Record<string, string> {
  const out: Record<string, string> = {}
  for (const field of config.fields) {
    const held = field.secret && config.set.includes(field.key)
    const problem = problemOf(field, draft[field.key] ?? blank(field), held)
    if (problem) out[field.key] = problem
  }
  return out
}

/** The values to save: what changed, typed; an emptied number or text is saved empty. */
export function changesToSave(
  config: ListingConfig,
  draft: ConfigDraft,
): Record<string, ConfigValue> {
  const out: Record<string, ConfigValue> = {}
  for (const key of changedKeys(config, draft)) {
    const field = config.fields.find((candidate) => candidate.key === key)!
    const value = draft[key]!
    out[key] = field.type === 'number' && value !== '' ? Number(value) : (value as ConfigValue)
  }
  return out
}
