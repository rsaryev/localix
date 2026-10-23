import { Buffer } from 'node:buffer'

import { fnv1aHex } from './fnv1a'
import { estimateTokens } from './tokens'
import { parseResourceUri } from './resource-refs'
import type {
  ContextContribution,
  ContextDestination,
  ContextProviderContribution,
  ContextResolver,
  ContextSensitivity,
} from './context-fabric'

/**
 * RESOURCE-BACKED CONTEXT PROVIDER FACTORY — the one place the "explicit resource
 * reference → Context Fabric contribution" machinery lives.
 *
 * Every domain that owns a resource-ref URI provider
 * needs the SAME resolver: gate on provider ownership, expand the URI through the
 * domain's own read-only resource provider, and emit ONE revisioned contribution.
 * That machinery — the FNV-1a content revision, the byte/token estimate, the URI
 * parse, the abort checks, the capture-then-replay contribution shape — is hidden
 * here. A domain declares only what is genuinely its own: its identity, its provider,
 * the namespace it stamps on emitted artefacts, and the expander to read through.
 *
 * CAPTURE-THEN-REPLAY is the contract this factory encodes: `resolve` reads the
 * live resource ONCE, at capture time, and the persisted `content` + `revision`
 * are what get replayed. A regenerate therefore cannot silently observe later
 * repo/daemon/cluster state — the snapshot is immutable once taken.
 *
 * OWNERSHIP + REDACTION are NOT re-implemented here: passing the domain's existing
 * resource provider as the {@link ResourceContextExpander} inherits its userId
 * ownership checks and its no-credentials expansion contract unchanged.
 */

/**
 * The single read a resource-backed context provider needs. A domain's
 * `ResourceRefProvider` satisfies this structurally, so callers pass theirs directly —
 * INCLUDING its `provider`, which is why {@link ResourceContextProviderSpec.provider} is
 * not something a caller should have to spell a second time.
 */
export interface ResourceContextExpander {
  /** The URI provider this expander owns. A `ResourceRefProvider` always carries it. */
  readonly provider?: string
  expand(
    userId: string,
    uri: string,
    scope?: { sessionId?: string },
  ): Promise<{ ok: boolean; content?: string; language?: string }>
}

/** Derives the contribution's semantic `kind` from the expansion's language hint. */
export type ResourceContextKind = (language: string | undefined) => string

/**
 * The default kind shape: a language-tagged label (`git/diff`) when the expansion
 * declares one, else the namespace's plain resource label (`git-resource`).
 */
export function namespacedResourceKind(namespace: string): ResourceContextKind {
  return (language) => (language ? `${namespace}/${language}` : `${namespace}-resource`)
}

export interface ResourceContextProviderSpec {
  /** Resolver identity, unique across the registry (e.g. `git-context`). */
  id: string
  /** Resolver version. Bump when the emitted content shape changes. Default `'1'`. */
  version?: string
  /**
   * The resource-ref URI provider this provider owns (`git`, `db`, `docker`, `k8s`, `trade`).
   *
   * DO NOT PASS THIS. It is derived from {@link expander}`.provider` — the domain's own
   * `ResourceRefProvider`, which is the authority on the provider it owns. Spelling it
   * again here is how the provider became a SECOND piece of the same knowledge, and every
   * such re-spelling is a `providers.test.ts` debt entry. The parameter survives only for
   * an expander that carries no `provider` (a bare structural stand-in, e.g. a test fake).
   */
  provider?: string
  /**
   * Domain namespace stamped on the artefacts this provider emits: the contribution
   * id (`<namespace>-resource:<referenceId>`) and — unless {@link kind} overrides it —
   * the contribution kind. Distinct from `provider` on purpose: resource URIs are owned
   * by the `kubernetes` namespace.
   */
  namespace: string
  /**
   * Resolves an owned URI to model-facing text. Normally the domain's own read-only
   * resource provider, so its ownership checks and redaction stay in one boundary.
   */
  expander: ResourceContextExpander
  /** Override the emitted kind (a provider may map a source type to a host-facing kind and emit
   *  one constant kind). Default: {@link namespacedResourceKind} over `namespace`. */
  kind?: ResourceContextKind
  /**
   * Narrows ownership BEYOND the provider, when a domain exposes only part of its own
   * URI tree to the fabric (for example, admitting only a public-data subtree).
   * Applied on every entry point, so a reference outside the admitted subtree can
   * never be estimated or captured.
   */
  accepts?: (uri: string) => boolean
  /** Namespace of the opaque content-revision string. Default `<provider>-content`. */
  revisionPrefix?: string
  destinations?: readonly ContextDestination[]
  sensitivity?: ContextSensitivity
  /** Rank among competing contributions. A function lets hierarchical domains
   * prefer a specifically selected entity over its broad root inventory. */
  priority?: number | ((uri: string, language: string | undefined) => number)
  maxTokens?: number
  timeoutMs?: number
  defaultEnabled?: boolean
}

/**
 * A resource the user linked or is looking at grounds every kind of request: the message they
 * send, the editor's next edit, and the ghost text in whatever field they are typing in.
 */
const DEFAULT_DESTINATIONS: readonly ContextDestination[] = [
  'edit-prediction',
  'inline-completion',
  'chat',
]

/**
 * Identity of the exact model-visible snapshot — NOT an assertion about live domain
 * state. FNV-1a over the captured content, namespaced per provider so two domains
 * can never collide on an identical string.
 */
function contentRevision(prefix: string, content: string): string {
  return `${prefix}:${fnv1aHex(content)}:${Buffer.byteLength(content, 'utf8')}`
}

/** Builds the explicit-activation Context Fabric contribution for one resource provider. */
export function createResourceContextProvider(
  spec: ResourceContextProviderSpec,
): ContextProviderContribution {
  // The expander IS the domain's resource provider, and a resource provider knows the
  // provider it owns. Deriving it here is what lets a caller stop re-spelling it — the
  // duplication `resource-refs/providers.ts` exists to prevent.
  const provider = spec.provider ?? spec.expander.provider
  if (!provider) {
    throw new Error(
      `createResourceContextProvider("${spec.id}"): no provider — the expander must carry one (every ResourceRefProvider does), or pass \`provider\` explicitly.`,
    )
  }
  const version = spec.version ?? '1'
  const revisionPrefix = spec.revisionPrefix ?? `${provider}-content`
  const kindOf = spec.kind ?? namespacedResourceKind(spec.namespace)
  const destinations = spec.destinations ?? DEFAULT_DESTINATIONS
  const sensitivity = spec.sensitivity ?? 'project'
  const priority = spec.priority ?? 1_000
  const priorityOf = (uri: string, language: string | undefined) =>
    typeof priority === 'function' ? priority(uri, language) : priority

  /** A URI this provider is allowed to read: right provider, and inside any admitted subtree. */
  const owns = (uri: string | undefined): uri is string =>
    typeof uri === 'string' &&
    parseResourceUri(uri)?.provider === provider &&
    (spec.accepts?.(uri) ?? true)

  const resolver: ContextResolver = {
    id: spec.id,
    version,
    supports(reference, destination) {
      return (
        destinations.includes(destination) && reference.kind === 'resource' && owns(reference.uri)
      )
    },
    async estimate(reference, _ctx, signal) {
      if (signal.aborted || !owns(reference.uri)) return { bytes: 0, tokens: 0 }
      const expansion = await spec.expander.expand(reference.scope.userId, reference.uri, {
        sessionId: reference.scope.sessionId,
      })
      if (signal.aborted || !expansion.ok) return { bytes: 0, tokens: 0 }
      const content = expansion.content ?? ''
      return {
        bytes: Buffer.byteLength(content, 'utf8'),
        tokens: estimateTokens(content),
        revision: contentRevision(revisionPrefix, content),
      }
    },
    async resolve(reference, ctx, signal): Promise<ContextContribution[]> {
      if (signal.aborted || !owns(reference.uri)) return []
      const expansion = await spec.expander.expand(ctx.userId, reference.uri, {
        sessionId: ctx.sessionId,
      })
      if (signal.aborted || !expansion.ok || !expansion.content) return []
      return [
        {
          id: `${spec.namespace}-resource:${reference.id}`,
          providerId: spec.id,
          providerVersion: version,
          scope: 'session',
          kind: kindOf(expansion.language),
          content: expansion.content,
          uri: reference.uri,
          revision: contentRevision(revisionPrefix, expansion.content),
          priority: priorityOf(reference.uri, expansion.language),
          sensitivity,
          relevanceHints: { explicit: true },
        },
      ]
    },
  }

  return {
    provider: resolver,
    destinations,
    activation: 'explicit',
    defaultEnabled: spec.defaultEnabled ?? true,
    maxTokens: spec.maxTokens ?? 2_000,
    timeoutMs: spec.timeoutMs ?? 1_500,
    sensitivity,
  }
}
