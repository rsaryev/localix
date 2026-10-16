import type { IconComponent, PluginOwnedContribution } from './contrib'
import type { UiAnchorOpenResult } from './anchors'
import type { LocalixUiPrimitive } from '../navigation'
import type { UI_AGENT_LOCATION_CATALOG_VERSION } from './location-wire-values'

export {
  UI_LOCATION_QUERY_ENTRY_LIMIT,
  UI_LOCATION_DEFAULT_STRING_MAX,
  UI_LOCATION_DEFAULT_ARRAY_MAX,
  UI_AGENT_LOCATION_CATALOG_LIMIT,
  UI_AGENT_LOCATION_CATALOG_VERSION,
  normalizeUiLocationBaseUri,
  isValidUiMutationBaseUri,
} from './location-wire-values'
export {
  isValidUiLocationParamSchema,
  isValidUiLocationAgentMetadata,
} from './location-schema-guards'
export {
  normalizeUiAgentLocationDescriptor,
  normalizeUiAgentLocationCatalogSnapshot,
} from './location-catalog'

export { parseUiLocationArgs, buildUiLocationUri } from './location-args'

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
