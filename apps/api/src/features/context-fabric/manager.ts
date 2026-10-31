import type {
  AutomaticContextRequest,
  ContextContribution,
  ContextReference,
  ResolveContext,
  ContextSensitivity,
} from '@localixai/mini-app-sdk/backend'
import { mapLimit } from '../../lib/map-limit'
import type { ContextProviderRegistry } from './registry'
import { createContextPolicy } from './policy'

export interface ContextPackOptions {
  maxBytes: number
  maxItems: number
  /** The active document sorts before supporting contributions after dedupe. */
  activeUri?: string
  /** Sensitive data is deny-by-default for auxiliary model tasks. */
  allowSensitive?: boolean
}

export type ContextDropReason =
  | 'forbidden'
  | 'sensitive'
  | 'empty'
  | 'duplicate'
  | 'budget'
  | 'excluded_uri'
  | 'secret'
  | 'path_unresolved'
  | 'aborted'
  | 'provider_identity'
  | 'provider_sensitivity'
  | 'provider_quota'

/** High-confidence secret material only. This deliberately avoids flagging names
 * such as `process.env.API_KEY`; providers must label lower-confidence material. */
const SECRET_CONTENT =
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"'\r\n]{16,}["']/i
const EXCLUDED_URI =
  /(?:^|\/)(?:\.env(?:\.[^/]*)?|credentials(?:\.json)?|id_(?:rsa|ed25519)|\.npmrc)$/i

function isSafeUri(uri: string | undefined): boolean {
  if (!uri) return true
  // Reject traversal before a plugin gets a chance to smuggle a filesystem path into
  // a contribution. Opaque non-file resource schemes remain provider-owned.
  if (uri.split(/[\\/]/).includes('..')) return false
  return !EXCLUDED_URI.test(uri)
}

function isNoMoreSensitive(value: ContextSensitivity, maximum: ContextSensitivity): boolean {
  return sensitivityRank(value) <= sensitivityRank(maximum)
}

/**
 * Plugin output is data, not authority. A provider cannot impersonate another
 * provider, escalate its registered sensitivity, or exceed its declared quota.
 */
function shapeProviderOutput(
  items: readonly ContextContribution[],
  provider: { id: string; version: string },
  maximumSensitivity: ContextSensitivity,
  maxTokens: number,
): ContextPackResult {
  const dropped: ContextPackResult['dropped'] = []
  const trusted: ContextContribution[] = []
  for (const item of items) {
    if (item.providerId !== provider.id || item.providerVersion !== provider.version) {
      dropped.push({ id: item.id, reason: 'provider_identity' })
      continue
    }
    if (!isNoMoreSensitive(item.sensitivity, maximumSensitivity)) {
      dropped.push({ id: item.id, reason: 'provider_sensitivity' })
      continue
    }
    trusted.push(item)
  }
  const quotaPacked = packContextContributions(trusted, { maxBytes: maxTokens * 4, maxItems: 8 })
  const quotaDropped = quotaPacked.dropped.map((item) =>
    item.reason === 'budget' ? { ...item, reason: 'provider_quota' as const } : item,
  )
  const allDropped = [...dropped, ...quotaDropped]
  const droppedByReason: ContextPackResult['diagnostics']['droppedByReason'] = {}
  for (const { reason } of allDropped) droppedByReason[reason] = (droppedByReason[reason] ?? 0) + 1
  return {
    contributions: quotaPacked.contributions,
    dropped: allDropped,
    diagnostics: { droppedByReason },
    bytes: quotaPacked.bytes,
  }
}

export interface ContextPackResult {
  contributions: ContextContribution[]
  dropped: Array<{ id: string; reason: ContextDropReason }>
  /** Safe aggregation for telemetry: never carries contribution text, URI or id. */
  diagnostics: { droppedByReason: Partial<Record<ContextDropReason, number>> }
  bytes: number
}

export interface ContextCollectionResult extends ContextPackResult {
  providerOutcomes: Array<{
    providerId: string
    /** `reference_*` values are safe, typed resolution failures; no reference URI,
     * label or resolver error ever reaches diagnostics/telemetry. */
    status:
      | 'ok'
      | 'timeout'
      | 'deadline_exceeded'
      | 'error'
      | 'aborted'
      | 'reference_out_of_scope'
      | 'resolver_not_found'
    contributionCount: number
  }>
}

/**
 * Durable, per-reference outcome for a Fabric explicit-resolution operation.
 * It intentionally contains no URI, label, resolver exception, or provider-private
 * diagnostic: callers may persist it as capture provenance or aggregate it in
 * telemetry without widening the context disclosure surface.
 */
export type ExplicitReferenceStatus =
  | 'resolved'
  | 'empty'
  | 'unsupported'
  | 'out_of_scope'
  | 'denied'
  | 'timeout'
  | 'deadline_exceeded'
  | 'aborted'
  | 'error'

export interface ExplicitReferenceOutcome {
  referenceId: string
  status: ExplicitReferenceStatus
  /** IDs are internal correlation keys only; never expose this structure to a client. */
  contributionIds: string[]
}

export interface ExplicitContextCollectionResult extends ContextCollectionResult {
  referenceOutcomes: ExplicitReferenceOutcome[]
}

export interface ContextManager {
  collect(
    request: AutomaticContextRequest,
    explicit: readonly ContextContribution[],
    signal: AbortSignal,
  ): Promise<ContextCollectionResult>
  resolveExplicit(
    request: ResolveContext,
    references: readonly ContextReference[],
    signal: AbortSignal,
  ): Promise<ExplicitContextCollectionResult>
}

/** Explicit refs share one end-to-end deadline. A small bounded fan-out prevents
 * one cold plugin provider from consuming that deadline before later refs start. */
const EXPLICIT_RESOLVE_CONCURRENCY = 4
/** Contributions a destination packs when its request does not say (`ResolveContext.maxItems`). */
const DEFAULT_CONTEXT_ITEMS = 8

function referenceIsInScope(reference: ContextReference, request: ResolveContext): boolean {
  const scope = reference.scope
  return (
    scope.userId === request.userId &&
    (!scope.projectId || scope.projectId === request.projectId) &&
    (!scope.sessionId || scope.sessionId === request.sessionId) &&
    (!scope.isolationId || scope.isolationId === request.isolationId)
  )
}

function sensitivityRank(value: ContextSensitivity): number {
  return value === 'public' ? 0 : value === 'project' ? 1 : value === 'sensitive' ? 2 : 3
}

/**
 * Deterministic, destination-agnostic contribution packing. This is intentionally
 * policy-minimal: forbidden data never survives; callers must opt in before passing
 * sensitive data. URI/range dedupe prevents duplicate provider snapshots from
 * displacing a higher-priority contribution.
 */
export function packContextContributions(
  inputs: readonly ContextContribution[],
  options: ContextPackOptions,
): ContextPackResult {
  const dropped: ContextPackResult['dropped'] = []
  const drop = (id: string, reason: ContextDropReason) => dropped.push({ id, reason })
  const candidates = new Map<string, ContextContribution>()
  for (const item of inputs) {
    if (item.sensitivity === 'forbidden') {
      drop(item.id, 'forbidden')
      continue
    }
    if (item.sensitivity === 'sensitive' && !options.allowSensitive) {
      drop(item.id, 'sensitive')
      continue
    }
    if (!item.content.trim()) {
      drop(item.id, 'empty')
      continue
    }
    if (!isSafeUri(item.uri)) {
      drop(item.id, 'excluded_uri')
      continue
    }
    if (SECRET_CONTENT.test(item.content)) {
      drop(item.id, 'secret')
      continue
    }
    const key = `${item.uri ?? item.id}\n${item.range ? JSON.stringify(item.range) : ''}`
    const previous = candidates.get(key)
    if (!previous) {
      candidates.set(key, item)
      continue
    }
    const nextWins =
      (item.uri === options.activeUri && previous.uri !== options.activeUri) ||
      item.priority > previous.priority ||
      (item.priority === previous.priority &&
        sensitivityRank(item.sensitivity) < sensitivityRank(previous.sensitivity))
    drop(nextWins ? previous.id : item.id, 'duplicate')
    if (nextWins) candidates.set(key, item)
  }

  const ordered = [...candidates.values()].sort((a, b) => {
    const active = Number(b.uri === options.activeUri) - Number(a.uri === options.activeUri)
    return active || b.priority - a.priority || a.id.localeCompare(b.id)
  })
  const contributions: ContextContribution[] = []
  let bytes = 0
  for (const item of ordered) {
    const size = Buffer.byteLength(item.content, 'utf8')
    if (contributions.length >= options.maxItems || bytes + size > options.maxBytes) {
      drop(item.id, 'budget')
      continue
    }
    contributions.push(item)
    bytes += size
  }
  const droppedByReason: ContextPackResult['diagnostics']['droppedByReason'] = {}
  for (const { reason } of dropped) droppedByReason[reason] = (droppedByReason[reason] ?? 0) + 1
  return { contributions, dropped, diagnostics: { droppedByReason }, bytes }
}

function providerCall<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parent: AbortSignal,
  deadlineAtMs?: number,
): Promise<
  { status: 'ok'; value: T } | { status: 'timeout' | 'deadline_exceeded' | 'error' | 'aborted' }
> {
  return new Promise((resolve) => {
    const deadlineExpired = () => deadlineAtMs !== undefined && Date.now() >= deadlineAtMs
    if (parent.aborted || deadlineExpired())
      return resolve({ status: deadlineExpired() ? 'deadline_exceeded' : 'aborted' })
    const controller = new AbortController()
    const abort = () => {
      controller.abort()
      settle({ status: deadlineExpired() ? 'deadline_exceeded' : 'aborted' })
    }
    const remainingMs = deadlineAtMs === undefined ? timeoutMs : deadlineAtMs - Date.now()
    const effectiveTimeoutMs = Math.min(timeoutMs, Math.max(0, remainingMs))
    const timer = setTimeout(() => {
      controller.abort()
      settle({ status: deadlineExpired() ? 'deadline_exceeded' : 'timeout' })
    }, effectiveTimeoutMs)
    let settled = false
    const settle = (
      result:
        | { status: 'ok'; value: T }
        | { status: 'timeout' | 'deadline_exceeded' | 'error' | 'aborted' },
    ) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      parent.removeEventListener('abort', abort)
      resolve(result)
    }
    parent.addEventListener('abort', abort, { once: true })
    void run(controller.signal).then(
      (value) =>
        settle(
          controller.signal.aborted
            ? {
                status: deadlineExpired()
                  ? 'deadline_exceeded'
                  : parent.aborted
                    ? 'aborted'
                    : 'timeout',
              }
            : { status: 'ok', value },
        ),
      () =>
        settle({
          status: deadlineExpired()
            ? 'deadline_exceeded'
            : parent.aborted
              ? 'aborted'
              : controller.signal.aborted
                ? 'timeout'
                : 'error',
        }),
    )
  })
}

/**
 * Executes automatic context providers under host-owned cancellation and deadlines.
 * Providers are isolated: an unavailable plugin only loses its own contribution;
 * it cannot fail or delay the model task. Explicit contributions are still shaped by
 * the same privacy, dedupe and budget policy as provider output.
 */
export function createContextManager(registry: ContextProviderRegistry): ContextManager {
  const admissionPolicy = createContextPolicy()
  const admit = async (
    items: readonly ContextContribution[],
    request: ResolveContext,
    signal: AbortSignal,
  ) => {
    const admitted: ContextContribution[] = []
    const dropped: ContextPackResult['dropped'] = []
    const decisions = await Promise.all(
      items.map(async (item) => ({
        item,
        decision: await admissionPolicy.admit(item, request, signal),
      })),
    )
    for (const { item, decision } of decisions) {
      if (decision.ok) admitted.push(decision.contribution)
      else dropped.push({ id: item.id, reason: decision.reason })
    }
    return { admitted, dropped }
  }
  const merge = (
    packed: ContextPackResult,
    policyDropped: ContextPackResult['dropped'],
  ): ContextPackResult => {
    const dropped = [...policyDropped, ...packed.dropped]
    const droppedByReason: ContextPackResult['diagnostics']['droppedByReason'] = {}
    for (const { reason } of dropped) droppedByReason[reason] = (droppedByReason[reason] ?? 0) + 1
    return { ...packed, dropped, diagnostics: { droppedByReason } }
  }
  return {
    async collect(request, explicit, signal) {
      const providerOutcomes: ContextCollectionResult['providerOutcomes'] = []
      const collected = [...explicit]
      const providerDropped: ContextPackResult['dropped'] = []
      const providers = registry.automaticProviders(request.destination)
      await Promise.all(
        providers.map(async (entry) => {
          const result = await providerCall(
            (providerSignal) => entry.provider.provide(request, providerSignal),
            entry.timeoutMs,
            signal,
            request.deadlineAtMs,
          )
          if (result.status === 'ok') {
            const shaped = shapeProviderOutput(
              result.value,
              entry.provider,
              entry.sensitivity,
              entry.maxTokens,
            )
            collected.push(...shaped.contributions)
            providerDropped.push(...shaped.dropped)
            providerOutcomes.push({
              providerId: entry.provider.id,
              status: 'ok',
              contributionCount: shaped.contributions.length,
            })
          } else {
            providerOutcomes.push({
              providerId: entry.provider.id,
              status: result.status,
              contributionCount: 0,
            })
          }
        }),
      )
      const admission = await admit(collected, request, signal)
      return {
        ...merge(
          packContextContributions(admission.admitted, {
            activeUri: request.document?.uri,
            maxBytes: request.maxBytes,
            maxItems: request.maxItems ?? DEFAULT_CONTEXT_ITEMS,
          }),
          [...providerDropped, ...admission.dropped],
        ),
        providerOutcomes,
      }
    },
    async resolveExplicit(request, references, signal) {
      const providerOutcomes: ContextCollectionResult['providerOutcomes'] = []
      const collected: ContextContribution[] = []
      const providerDropped: ContextPackResult['dropped'] = []
      const referenceOutcomes: ExplicitReferenceOutcome[] = []
      const resolvers = registry.resolvers(request.destination)
      /** A reference that never reached a provider: nothing collected, nothing dropped. */
      const skipped = (
        referenceId: string,
        status: ExplicitReferenceOutcome['status'],
        providerOutcome?: ContextCollectionResult['providerOutcomes'][number],
      ) => ({
        contributions: [],
        dropped: [],
        ...(providerOutcome ? { providerOutcome } : {}),
        referenceOutcome: { referenceId, status, contributionIds: [] },
      })
      const attempts = await mapLimit(
        [...references],
        EXPLICIT_RESOLVE_CONCURRENCY,
        async (
          reference,
        ): Promise<{
          contributions: ContextContribution[]
          dropped: ContextPackResult['dropped']
          providerOutcome?: ContextCollectionResult['providerOutcomes'][number]
          referenceOutcome: ExplicitReferenceOutcome
        }> => {
          const deadlineExpired =
            request.deadlineAtMs !== undefined && Date.now() >= request.deadlineAtMs
          if (signal.aborted || deadlineExpired) {
            return skipped(reference.id, deadlineExpired ? 'deadline_exceeded' : 'aborted')
          }
          if (!referenceIsInScope(reference, request)) {
            return skipped(reference.id, 'out_of_scope', {
              providerId: `reference:${reference.id}`,
              status: 'reference_out_of_scope',
              contributionCount: 0,
            })
          }
          const entry = resolvers.find((candidate) =>
            candidate.provider.supports(reference, request.destination),
          )
          if (!entry) {
            return skipped(reference.id, 'unsupported', {
              providerId: `reference:${reference.id}`,
              status: 'resolver_not_found',
              contributionCount: 0,
            })
          }
          // ONE read per reference. This deliberately does NOT pre-size the reference via
          // `estimate` first: a resource-backed resolver has no cheap way to size a
          // reference without expanding it, so `estimate` performed the SAME live expansion
          // `resolve` was about to repeat — two full round-trips per reference, both billed
          // against one deadline. That is what made a linked chart (a full loadMarkets plus
          // a ticker read, twice) blow its deadline and disappear.
          //
          // The quota is not weakened by dropping the pre-check: `shapeProviderOutput` below
          // enforces `entry.maxTokens` on what the provider actually returned, and an
          // over-quota contribution is dropped as `provider_quota` there. Enforcing the
          // declared budget against real output rather than a provider's self-reported
          // estimate is also the stricter of the two.
          const result = await providerCall(
            (providerSignal) => entry.provider.resolve(reference, request, providerSignal),
            entry.timeoutMs,
            signal,
            request.deadlineAtMs,
          )
          if (result.status === 'ok') {
            const shaped = shapeProviderOutput(
              result.value,
              entry.provider,
              entry.sensitivity,
              entry.maxTokens,
            )
            const contributionIds = shaped.contributions.map((item) => item.id)
            // The final status depends on admission and global packing, below.
            return {
              contributions: shaped.contributions,
              dropped: shaped.dropped,
              providerOutcome: {
                providerId: entry.provider.id,
                status: 'ok',
                contributionCount: shaped.contributions.length,
              },
              referenceOutcome: {
                referenceId: reference.id,
                status:
                  result.value.length === 0
                    ? 'empty'
                    : contributionIds.length === 0
                      ? 'denied'
                      : 'empty',
                contributionIds,
              },
            }
          }
          return skipped(reference.id, result.status, {
            providerId: entry.provider.id,
            status: result.status,
            contributionCount: 0,
          })
        },
      )
      // `mapLimit` preserves reference order, so capture provenance and diagnostics
      // remain deterministic even though provider I/O overlaps.
      for (const attempt of attempts) {
        collected.push(...attempt.contributions)
        providerDropped.push(...attempt.dropped)
        if (attempt.providerOutcome) providerOutcomes.push(attempt.providerOutcome)
        referenceOutcomes.push(attempt.referenceOutcome)
      }
      const admission = await admit(collected, request, signal)
      const merged = merge(
        packContextContributions(admission.admitted, {
          maxBytes: request.maxBytes,
          maxItems: request.maxItems ?? DEFAULT_CONTEXT_ITEMS,
        }),
        [...providerDropped, ...admission.dropped],
      )
      const admittedIds = new Set(merged.contributions.map((item) => item.id))
      const droppedIds = new Set(merged.dropped.map((item) => item.id))
      for (const outcome of referenceOutcomes) {
        if (outcome.status !== 'empty' || outcome.contributionIds.length === 0) continue
        if (outcome.contributionIds.some((id) => admittedIds.has(id))) outcome.status = 'resolved'
        else if (outcome.contributionIds.some((id) => droppedIds.has(id))) outcome.status = 'denied'
      }
      return { ...merged, providerOutcomes, referenceOutcomes }
    },
  }
}
