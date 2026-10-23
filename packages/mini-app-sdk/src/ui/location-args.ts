import { LOCALIX_URI_MAX_CHARS } from '../navigation'
import type { UiLocationParamDefinition, UiLocationParamSchema, UiSurfaceKind } from './locations'
import { isValidUiLocationParamSchema } from './location-schema-guards'
import {
  hasOwn,
  isRecord,
  normalizeUiLocationBaseUri,
  UI_LOCATION_QUERY_ENTRY_LIMIT,
  UI_LOCATION_DEFAULT_STRING_MAX,
  UI_LOCATION_DEFAULT_ARRAY_MAX,
} from './location-wire-values'

type NormalizedUiLocationArgs = Record<string, string | string[] | boolean | number>

function parseBoolean(value: string): boolean | null {
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

function parseInteger(value: string): number | null {
  if (!/^-?(0|[1-9]\d*)$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parseScalar(
  definition: Exclude<UiLocationParamDefinition, { type: 'string-array' }>,
  value: string,
): string | boolean | number | null {
  if (definition.type === 'boolean') return parseBoolean(value)
  if (definition.type === 'integer') {
    const parsed = parseInteger(value)
    if (
      parsed === null ||
      (definition.minimum !== undefined && parsed < definition.minimum) ||
      (definition.maximum !== undefined && parsed > definition.maximum)
    ) {
      return null
    }
    return parsed
  }
  if (
    (!definition.allowEmpty && value.length === 0) ||
    value.length > (definition.maxLength ?? UI_LOCATION_DEFAULT_STRING_MAX) ||
    (definition.values && !definition.values.includes(value))
  ) {
    return null
  }
  return value
}

function appendUiLocationArg(
  params: URLSearchParams,
  key: string,
  definition: UiLocationParamDefinition,
  value: unknown,
): boolean {
  if (value === undefined) return definition.optional === true
  if (definition.type === 'string-array') {
    if (!Array.isArray(value)) return false
    for (const entry of value) {
      if (typeof entry !== 'string') return false
      params.append(key, entry)
    }
    return true
  }
  if (definition.type === 'string' && typeof value !== 'string') return false
  if (definition.type === 'boolean' && typeof value !== 'boolean') return false
  if (definition.type === 'integer' && typeof value !== 'number') return false
  if (typeof value !== 'string' && typeof value !== 'boolean' && typeof value !== 'number') {
    return false
  }
  params.set(key, String(value))
  return true
}

/** Strictly parse one location's query. Unknown, duplicate, or malformed values fail closed. */
export function parseUiLocationArgs(
  schema: UiLocationParamSchema,
  searchParams: URLSearchParams,
): NormalizedUiLocationArgs | null {
  if (!isValidUiLocationParamSchema(schema)) return null
  const entries = Array.from(searchParams.entries())
  if (entries.length > UI_LOCATION_QUERY_ENTRY_LIMIT) return null
  if (entries.some(([key]) => !hasOwn(schema, key))) return null

  const args: NormalizedUiLocationArgs = Object.create(null) as NormalizedUiLocationArgs
  for (const [key, definition] of Object.entries(schema)) {
    const values = searchParams.getAll(key)
    if (values.length === 0) {
      if (!definition.optional) return null
      continue
    }
    if (definition.type === 'string-array') {
      if (
        values.length > (definition.maxItems ?? UI_LOCATION_DEFAULT_ARRAY_MAX) ||
        values.some(
          (value) =>
            value.length === 0 ||
            value.length > (definition.maxLength ?? UI_LOCATION_DEFAULT_STRING_MAX),
        )
      ) {
        return null
      }
      args[key] = values
      continue
    }
    if (values.length !== 1) return null
    const parsed = parseScalar(definition, values[0])
    if (parsed === null) return null
    args[key] = parsed
  }
  return args
}

/** Build and re-parse one URI so backend offers obey the frontend's exact schema. */
export function buildUiLocationUri(
  descriptor: { uri: string; surface: UiSurfaceKind; params: UiLocationParamSchema },
  args: Readonly<Record<string, unknown>> = {},
): string | null {
  const base = normalizeUiLocationBaseUri(descriptor.uri, descriptor.surface)
  if (!base || !isValidUiLocationParamSchema(descriptor.params) || !isRecord(args)) return null
  if (Object.keys(args).some((key) => !hasOwn(descriptor.params, key))) return null
  const params = new URLSearchParams()
  for (const [key, definition] of Object.entries(descriptor.params)) {
    if (!appendUiLocationArg(params, key, definition, args[key])) return null
  }
  const query = params.toString()
  const uri = query ? `${base}?${query}` : base
  if (uri.length > LOCALIX_URI_MAX_CHARS) return null
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    return null
  }
  return parseUiLocationArgs(descriptor.params, parsed.searchParams) ? uri : null
}
