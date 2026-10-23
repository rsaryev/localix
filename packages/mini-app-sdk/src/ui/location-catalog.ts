import type {
  UiAgentLocationDescriptor,
  UiAgentLocationCatalogSnapshot,
  UiSurfaceKind,
} from './locations'
import { isValidUiLocationParamSchema } from './location-schema-guards'
import {
  isRecord,
  containsAsciiControlCharacter,
  compareCanonicalStrings,
  normalizeUiLocationBaseUri,
  UI_SURFACE_KINDS,
  UI_AGENT_LOCATION_CATALOG_LIMIT,
  UI_AGENT_LOCATION_CATALOG_VERSION,
} from './location-wire-values'

/** Strict boundary validator for catalogs received from a frontend process. */
export function normalizeUiAgentLocationDescriptor(
  value: unknown,
): UiAgentLocationDescriptor | null {
  if (!isRecord(value)) return null
  const allowed = new Set(['uri', 'title', 'description', 'aliases', 'group', 'surface', 'params'])
  if (Object.keys(value).some((key) => !allowed.has(key))) return null
  const { uri, title, description, aliases, group, surface, params } = value
  if (
    (group !== undefined &&
      (typeof group !== 'string' ||
        !group.trim() ||
        group.length > 80 ||
        containsAsciiControlCharacter(group))) ||
    typeof uri !== 'string' ||
    typeof title !== 'string' ||
    !title.trim() ||
    title.length > 120 ||
    containsAsciiControlCharacter(title) ||
    typeof description !== 'string' ||
    !description.trim() ||
    description.length > 500 ||
    containsAsciiControlCharacter(description) ||
    (aliases !== undefined &&
      (!Array.isArray(aliases) ||
        aliases.length > 24 ||
        aliases.some(
          (alias) =>
            typeof alias !== 'string' ||
            !alias.trim() ||
            alias.length > 80 ||
            containsAsciiControlCharacter(alias),
        ))) ||
    typeof surface !== 'string' ||
    !UI_SURFACE_KINDS.has(surface) ||
    surface === 'action' ||
    !isValidUiLocationParamSchema(params) ||
    Object.values(params).some((definition) => !definition.description)
  ) {
    return null
  }
  const normalizedUri = normalizeUiLocationBaseUri(uri, surface as UiSurfaceKind)
  if (!normalizedUri) return null
  return {
    uri: normalizedUri,
    title: title.trim(),
    description: description.trim(),
    ...(Array.isArray(aliases)
      ? {
          aliases: [...new Set(aliases.map((alias) => alias.trim()))].sort((left, right) =>
            compareCanonicalStrings(left, right),
          ),
        }
      : {}),
    ...(typeof group === 'string' ? { group: group.trim() } : {}),
    surface: surface as Exclude<UiSurfaceKind, 'action'>,
    params: Object.fromEntries(
      Object.entries(params)
        .sort(([left], [right]) => compareCanonicalStrings(left, right))
        .map(([key, definition]) => [
          key,
          definition.type === 'string' && definition.values
            ? { ...definition, values: [...definition.values] }
            : { ...definition },
        ]),
    ),
  }
}

/** Validate, clone, and deterministically sort one complete wire snapshot. */
export function normalizeUiAgentLocationCatalogSnapshot(
  value: unknown,
): UiAgentLocationCatalogSnapshot | null {
  if (!isRecord(value)) return null
  if (
    Object.keys(value).some(
      (key) => key !== 'version' && key !== 'revision' && key !== 'locations',
    ) ||
    value.version !== UI_AGENT_LOCATION_CATALOG_VERSION ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    !Array.isArray(value.locations) ||
    value.locations.length > UI_AGENT_LOCATION_CATALOG_LIMIT
  ) {
    return null
  }
  const locations: UiAgentLocationDescriptor[] = []
  const uris = new Set<string>()
  for (const raw of value.locations) {
    const location = normalizeUiAgentLocationDescriptor(raw)
    if (!location || uris.has(location.uri)) return null
    uris.add(location.uri)
    locations.push(location)
  }
  locations.sort((left, right) => compareCanonicalStrings(left.uri, right.uri))
  return {
    version: UI_AGENT_LOCATION_CATALOG_VERSION,
    revision: value.revision as number,
    locations,
  }
}
