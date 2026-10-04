import type { IconComponent, PluginOwnedContribution } from './contrib'
import type { UiAnchorOpenResult } from './anchors'
import {
  LOCALIX_URI_MAX_CHARS,
  localixUiUri,
  parseLocalixUri,
  type LocalixUiPrimitive,
} from '../navigation'

export const UI_LOCATION_QUERY_ENTRY_LIMIT = 16
export const UI_LOCATION_DEFAULT_STRING_MAX = 512
export const UI_LOCATION_DEFAULT_ARRAY_MAX = 8
export const UI_AGENT_LOCATION_CATALOG_LIMIT = 128

const UI_LOCATION_PARAM_KEY = /^[a-z][a-z0-9_-]{0,63}$/
const UI_MUTATION_SEGMENT = /^[a-z0-9][a-z0-9._~-]{0,63}$/
const UI_SURFACE_KINDS: ReadonlySet<string> = new Set<UiSurfaceKind>([
  'page',
  'sidebar',
  'work-item',
  'overlay',
  'picker',
  'settings',
  'plugin',
  'command',
  'action',
])

type NormalizedUiLocationArgs = Record<string, string | string[] | boolean | number>

function containsAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

/** Locale-independent ordering for wire normalization and content identity. */
function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export type UiLocationParamDefinition =
  | {
      type: 'string'
      /** Model-facing meaning and provenance of this argument. */
      description?: string
      optional?: boolean
      allowEmpty?: boolean
      maxLength?: number
      values?: readonly string[]
    }
  | {
      type: 'boolean'
      /** Model-facing meaning and provenance of this argument. */
      description?: string
      optional?: boolean
    }
  | {
      type: 'integer'
      /** Model-facing meaning and provenance of this argument. */
      description?: string
      optional?: boolean
      minimum?: number
      maximum?: number
    }
  | {
      type: 'string-array'
      /** Model-facing meaning and provenance of this argument. */
      description?: string
      optional?: boolean
      maxItems?: number
      maxLength?: number
    }

export type UiLocationParamSchema = Readonly<Record<string, UiLocationParamDefinition>>

type UiLocationParamValue<T extends UiLocationParamDefinition> = T extends {
  type: 'string'
  values: readonly (infer TValue extends string)[]
}
  ? TValue
  : T['type'] extends 'boolean'
    ? boolean
    : T['type'] extends 'integer'
      ? number
      : T['type'] extends 'string-array'
        ? string[]
        : string

type UiLocationRequiredKeys<T extends UiLocationParamSchema> = {
  [K in keyof T]-?: T[K]['optional'] extends true ? never : K
}[keyof T]

type UiLocationOptionalKeys<T extends UiLocationParamSchema> = Exclude<
  keyof T,
  UiLocationRequiredKeys<T>
>

/** Typed arguments inferred from one location's serializable query schema. */
export type UiLocationArgs<T extends UiLocationParamSchema> = {
  [K in UiLocationRequiredKeys<T>]: UiLocationParamValue<T[K]>
} & {
  [K in UiLocationOptionalKeys<T>]?: UiLocationParamValue<T[K]>
}

export interface UiLocationPresentation {
  label: string
  description?: string
}

export interface UiLocationExposure {
  /** Include as an addressable node in `/open` and global UI search. */
  search?: boolean
  /** Eligible for a generated command-palette entry. */
  palette?: boolean
}

/**
 * Model-facing metadata is separate from user-facing palette copy. Its presence
 * is the explicit publication decision for the agent catalog.
 */
export interface UiLocationAgentMetadata {
  /** Explain when this destination helps and what opening it reveals. */
  description: string
  /**
   * Runtime-only destinations depend on mounted/live state and are deliberately
   * omitted from the backend catalog. They remain addressable from trusted live UI.
   */
  availability?: 'always' | 'runtime'
}

/**
 * Security classification for a URI-backed UI intent.
 *
 * `read` may only reveal, focus, or open UI. `write` may change application or
 * external state and is never eligible for agent exposure. There is deliberately
 * no default: every contribution must make the decision explicitly.
 */
export type UiLocationEffect = 'read' | 'write'

/** Architectural role of an independently addressable UI boundary. */
export type UiSurfaceKind = LocalixUiPrimitive

/** Context-only declarations are intentionally impossible to publish. */
export interface UiContextualExposure {
  agent?: never
  search?: never
  palette?: never
}

/**
 * A component boundary that looks standalone by name but is only meaningful
 * inside an owning route, item, or payload. It joins the architecture catalog
 * without minting a URI or becoming visible to the agent.
 */
export interface UiContextualSurfaceDeclaration {
  kind: 'contextual'
  id: string
  title: string
  surface: UiSurfaceKind
  effect: UiLocationEffect
  exposure: UiContextualExposure
  reason: string
}

export type UiContextualSurfaceInput = Omit<UiContextualSurfaceDeclaration, 'kind'>

/** Identity helper and runtime marker for a context-only component boundary. */
export function defineContextualUiSurface(
  declaration: UiContextualSurfaceInput,
): UiContextualSurfaceDeclaration {
  return { kind: 'contextual', ...declaration }
}

export function isContextualUiSurface(value: unknown): value is UiContextualSurfaceDeclaration {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'contextual'
  )
}

/**
 * One parameterized, addressable UI intent. `uri` is the exact base URI without
 * query or fragment; `params` is the only accepted query vocabulary. Read
 * intents represent destinations; write intents use the same strict mechanism
 * but require an explicitly trusted invocation path.
 *
 * The contribution is runtime-only. The host may serialize its metadata for a
 * tool surface, but callbacks and application data never leave the frontend.
 */
export interface UiLocationContribution<
  TParams extends UiLocationParamSchema = UiLocationParamSchema,
> extends PluginOwnedContribution {
  id: string
  uri: string
  title: string
  description?: string
  keywords?: readonly string[]
  group?: string
  Icon?: IconComponent
  /** Required so a new surface cannot silently bypass access classification. */
  effect: UiLocationEffect
  /** Required, machine-readable UI boundary category used by architecture checks. */
  surface: UiSurfaceKind
  /** Omit to keep this location out of agent discovery. */
  agent?: UiLocationAgentMetadata
  params?: TParams
  /**
   * Explicit publication policy. An empty object is valid for internal-only
   * intents; omitting the decision is not.
   */
  exposure: UiLocationExposure
  present?(args: UiLocationArgs<TParams>): UiLocationPresentation
  resolve(args: UiLocationArgs<TParams>): UiAnchorOpenResult | null
}

/** Identity helper that preserves literal parameter keys and inferred argument types. */
export function defineUiLocation<const TParams extends UiLocationParamSchema>(
  contribution: UiLocationContribution<TParams>,
): UiLocationContribution<TParams> {
  return contribution
}

/**
 * Declare a parameterized mutation in the same URI namespace as read locations.
 *
 * `params` is required, even when it is `{}`, so the owner explicitly declares
 * the complete accepted query vocabulary. Runtime registration independently
 * enforces this and rejects agent exposure.
 */
export type UiMutationContribution<TParams extends UiLocationParamSchema> = Omit<
  UiLocationContribution<TParams>,
  'agent' | 'effect' | 'params' | 'surface'
> & {
  effect: 'write'
  surface: 'action'
  params: TParams
  agent?: never
}

/** Identity helper for trusted, URI-backed mutations with a mandatory strict schema. */
export function defineUiMutation<const TParams extends UiLocationParamSchema>(
  contribution: UiMutationContribution<TParams>,
): UiMutationContribution<TParams> {
  return contribution
}

export interface UiLocationDescriptor {
  id: string
  uri: string
  title: string
  description?: string
  keywords: readonly string[]
  group?: string
  icon?: string
  effect: UiLocationEffect
  surface: UiSurfaceKind
  agent?: UiLocationAgentMetadata
  params: UiLocationParamSchema
  exposure: UiLocationExposure
}

/**
 * Minimal, read-only invariant published to the backend. It intentionally omits
 * UI callbacks, icons, plugin ownership, search keywords, and application data.
 */
export interface UiAgentLocationDescriptor {
  uri: string
  title: string
  description: string
  /** Bounded, component-owned search vocabulary; never shown as presentation copy. */
  aliases?: readonly string[]
  /**
   * The navigational neighbourhood a destination belongs to ("Settings", "Workspace"), copied
   * from the contribution's `group`. Ranked as a weak signal so a query that names an AREA
   * still lands near the right destinations, and listed back to the model when nothing
   * matched so its next query can be aimed instead of guessed.
   */
  group?: string
  surface: Exclude<UiSurfaceKind, 'action'>
  params: UiLocationParamSchema
}

export const UI_AGENT_LOCATION_CATALOG_VERSION = 1 as const

export interface UiAgentLocationCatalogSnapshot {
  version: typeof UI_AGENT_LOCATION_CATALOG_VERSION
  revision: number
  locations: readonly UiAgentLocationDescriptor[]
}

export type UiSurfaceCatalogEntry =
  | ({ kind: 'location' } & UiLocationDescriptor)
  | UiContextualSurfaceDeclaration

export interface UiSurfaceCatalogSnapshot {
  revision: number
  surfaces: readonly UiSurfaceCatalogEntry[]
}

export interface ResolvedUiLocation {
  descriptor: UiLocationDescriptor
  args: Record<string, string | string[] | boolean | number>
  target: UiAnchorOpenResult
  presentation: UiLocationPresentation
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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

/** Validate the one serializable query vocabulary shared by frontend and backend. */
export function isValidUiLocationParamSchema(schema: unknown): schema is UiLocationParamSchema {
  if (!isRecord(schema)) return false
  const entries = Object.entries(schema)
  if (entries.length > UI_LOCATION_QUERY_ENTRY_LIMIT) return false
  return entries.every(([key, rawDefinition]) => {
    if (!UI_LOCATION_PARAM_KEY.test(key) || !isRecord(rawDefinition)) return false
    const definition = rawDefinition as unknown as UiLocationParamDefinition
    const allowedKeys =
      definition.type === 'string'
        ? new Set(['type', 'description', 'optional', 'allowEmpty', 'maxLength', 'values'])
        : definition.type === 'boolean'
          ? new Set(['type', 'description', 'optional'])
          : definition.type === 'integer'
            ? new Set(['type', 'description', 'optional', 'minimum', 'maximum'])
            : definition.type === 'string-array'
              ? new Set(['type', 'description', 'optional', 'maxItems', 'maxLength'])
              : null
    if (!allowedKeys || Object.keys(rawDefinition).some((field) => !allowedKeys.has(field))) {
      return false
    }
    if (definition.optional !== undefined && typeof definition.optional !== 'boolean') return false
    if (
      definition.description !== undefined &&
      (typeof definition.description !== 'string' ||
        !definition.description.trim() ||
        definition.description.length > 240 ||
        containsAsciiControlCharacter(definition.description))
    ) {
      return false
    }
    if (definition.type === 'string') {
      if (definition.allowEmpty !== undefined && typeof definition.allowEmpty !== 'boolean') {
        return false
      }
      return (
        (definition.maxLength === undefined ||
          (Number.isInteger(definition.maxLength) &&
            definition.maxLength! > 0 &&
            definition.maxLength! <= LOCALIX_URI_MAX_CHARS)) &&
        (definition.values === undefined ||
          (Array.isArray(definition.values) &&
            definition.values.length > 0 &&
            definition.values.length <= 32 &&
            new Set(definition.values).size === definition.values.length &&
            definition.values.every(
              (value) => typeof value === 'string' && value.length > 0 && value.length <= 128,
            )))
      )
    }
    if (definition.type === 'integer') {
      if (
        (definition.minimum !== undefined && !Number.isSafeInteger(definition.minimum)) ||
        (definition.maximum !== undefined && !Number.isSafeInteger(definition.maximum))
      ) {
        return false
      }
      return (
        (definition.minimum ?? Number.MIN_SAFE_INTEGER) <=
        (definition.maximum ?? Number.MAX_SAFE_INTEGER)
      )
    }
    if (definition.type === 'string-array') {
      return (
        (definition.maxItems === undefined ||
          (Number.isInteger(definition.maxItems) &&
            definition.maxItems > 0 &&
            definition.maxItems <= UI_LOCATION_QUERY_ENTRY_LIMIT)) &&
        (definition.maxLength === undefined ||
          (Number.isInteger(definition.maxLength) &&
            definition.maxLength > 0 &&
            definition.maxLength <= UI_LOCATION_DEFAULT_STRING_MAX))
      )
    }
    return true
  })
}

export function isValidUiLocationAgentMetadata(value: unknown): value is UiLocationAgentMetadata {
  if (!isRecord(value)) return false
  if (Object.keys(value).some((key) => key !== 'description' && key !== 'availability')) {
    return false
  }
  return (
    typeof value.description === 'string' &&
    value.description.trim().length > 0 &&
    value.description.length <= 500 &&
    !containsAsciiControlCharacter(value.description) &&
    (value.availability === undefined ||
      value.availability === 'always' ||
      value.availability === 'runtime')
  )
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

/** Exact base URI normalization used by contribution and wire validation. */
export function normalizeUiLocationBaseUri(value: string, surface: UiSurfaceKind): string | null {
  if (!value || value.length > LOCALIX_URI_MAX_CHARS) return null
  const localix = parseLocalixUri(value)
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  if (
    localix?.primitive !== 'ui' ||
    localix.breadcrumbs.length < 2 ||
    localix.breadcrumbs[0] !== surface ||
    Array.from(localix.query).length > 0 ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    return null
  }
  const canonicalPath = localixUiUri(surface, localix.breadcrumbs.slice(1))
  return canonicalPath
}

export function isValidUiMutationBaseUri(value: string): boolean {
  const parsed = parseLocalixUri(value)
  const segments = parsed?.primitive === 'ui' ? parsed.breadcrumbs : []
  return (
    segments.length === 3 &&
    segments[0] === 'action' &&
    segments.slice(1).every((segment) => UI_MUTATION_SEGMENT.test(segment))
  )
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
