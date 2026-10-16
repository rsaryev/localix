/**
 * A resource that informed an agent/tool result.
 *
 * Sources are presentation provenance, not model content: a tool's `content`
 * remains the evidence packet replayed to the model, while this compact record
 * survives in the transcript so every host can explain where that context came
 * from. The vocabulary is deliberately tool/provider agnostic — built-ins,
 * plugins, MCP adapters and provider-native search all publish the same shape.
 */
export interface AgentSource {
  /** Stable within the source URI; callers should reuse it across retries. */
  id: string
  /** Open vocabulary (`web`, `document`, `message`, plugin-owned kinds, ...). */
  kind: string
  /** Human-readable label shown by transcript surfaces. */
  title: string
  /** Canonical locator. May be an http(s) URL or an application resource URI. */
  uri: string
  /**
   * How this source relates to the result:
   * - discovered: found but not loaded into model context;
   * - consulted: content was read and included in the tool evidence;
   * - cited: an upstream provider explicitly cited it.
   */
  role: 'discovered' | 'consulted' | 'cited'
  /** A failed read remains visible without pretending it informed the answer. */
  status: 'available' | 'failed'
  /** Search/extraction/provider adapter that supplied the record. */
  provider?: string
  /** Small presentation excerpt only; never a second copy of the full page. */
  snippet?: string
  /** ISO timestamp for time-sensitive provenance. */
  retrievedAt?: string
  /** Small, scalar extension bag for provider/plugin-specific presentation data. */
  metadata?: Record<string, string | number | boolean>
}

export const MAX_AGENT_SOURCES = 32

const MAX_AGENT_SOURCE_INPUTS = MAX_AGENT_SOURCES * 8
const MAX_ID_CHARS = 160
const MAX_KIND_CHARS = 80
const MAX_TITLE_CHARS = 320
const MAX_URI_CHARS = 4_096
const MAX_PROVIDER_CHARS = 120
const MAX_SNIPPET_CHARS = 1_000
const MAX_METADATA_ENTRIES = 12
const MAX_METADATA_STRING_CHARS = 500

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function boundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text ? text.slice(0, max) : undefined
}

/**
 * Deterministic id for a source whose producer did not supply one — FNV-1a over the URI, with a
 * caller-chosen prefix so ids stay readable about where they came from (`source-`, `mcp-`).
 *
 * Exported because there was a byte-identical second copy in the MCP adapter, and a third
 * scheme in the research tool. A collision here is cheap by construction: dedupe is keyed on
 * `kind\0uri`, never on the id, so two sources sharing one only ever costs a React key — which is
 * why a 32-bit hash is the right size and why the id scheme is safe to change.
 */
export function agentSourceId(uri: string, prefix = 'source-'): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < uri.length; i++) {
    hash ^= uri.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${prefix}${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function metadataOf(value: unknown): AgentSource['metadata'] {
  const source = record(value)
  if (!source) return undefined
  const out: NonNullable<AgentSource['metadata']> = {}
  for (const [rawKey, rawValue] of Object.entries(source).slice(0, MAX_METADATA_ENTRIES)) {
    const key = boundedString(rawKey, 80)
    if (!key) continue
    if (typeof rawValue === 'string') {
      out[key] = rawValue.slice(0, MAX_METADATA_STRING_CHARS)
    } else if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      out[key] = rawValue
    } else if (typeof rawValue === 'boolean') {
      out[key] = rawValue
    }
  }
  return Object.keys(out).length ? out : undefined
}

const ROLE_WEIGHT: Record<AgentSource['role'], number> = {
  discovered: 0,
  consulted: 1,
  cited: 2,
}

/**
 * Reconcile repeated observations of one resource without losing a later,
 * stronger fact. This matters for protocols such as MCP, where a tool may first
 * advertise a `resource_link` and then embed the same resource's content.
 *
 * Exported because the UI aggregates the same records across a message and needs the same
 * reconciliation. It kept a shortened copy that reconciled only title and snippet — benign today
 * (the caller pre-filters to available/non-discovered records, so the fields it drops happen to
 * agree), but a divergence waiting for the first caller that does not pre-filter.
 */
export function mergeSource(current: AgentSource, next: AgentSource): AgentSource {
  const preferred = ROLE_WEIGHT[next.role] > ROLE_WEIGHT[current.role] ? next : current
  const retrievedAt =
    next.retrievedAt && (!current.retrievedAt || next.retrievedAt > current.retrievedAt)
      ? next.retrievedAt
      : current.retrievedAt
  const metadata = metadataOf({ ...current.metadata, ...next.metadata })
  return {
    ...preferred,
    // Identity and dedupe fields remain stable from the first admitted record.
    id: current.id,
    kind: current.kind,
    uri: current.uri,
    role: ROLE_WEIGHT[next.role] > ROLE_WEIGHT[current.role] ? next.role : current.role,
    status: current.status === 'available' || next.status === 'available' ? 'available' : 'failed',
    title: next.title.length > current.title.length ? next.title : current.title,
    ...(current.provider || next.provider
      ? { provider: preferred.provider ?? current.provider ?? next.provider }
      : {}),
    ...(current.snippet || next.snippet
      ? {
          snippet:
            (next.snippet?.length ?? 0) > (current.snippet?.length ?? 0)
              ? next.snippet
              : current.snippet,
        }
      : {}),
    ...(retrievedAt ? { retrievedAt } : {}),
    ...(metadata ? { metadata } : {}),
  }
}

/**
 * Validate, bound and reconcile sources at the third-party tool boundary.
 * Invalid records are dropped; repeated kind+URI observations merge while
 * preserving the strongest available/consulted/cited fact.
 */
export function normalizeAgentSources(
  value: unknown,
  maxSources = MAX_AGENT_SOURCES,
): AgentSource[] {
  if (!Array.isArray(value)) return []
  const limit = Number.isFinite(maxSources)
    ? Math.max(0, Math.min(Math.trunc(maxSources), MAX_AGENT_SOURCES))
    : 0
  if (limit === 0) return []
  const out: AgentSource[] = []
  const indexByKey = new Map<string, number>()

  // Inspect a bounded multiple of the output ceiling: this permits a later
  // consulted/cited observation to upgrade an earlier discovery without letting
  // a malicious tool force an unbounded duplicate scan.
  for (const raw of value.slice(0, MAX_AGENT_SOURCE_INPUTS)) {
    const item = record(raw)
    if (!item) continue
    const uri = boundedString(item.uri, MAX_URI_CHARS)
    if (!uri) continue
    const kind = boundedString(item.kind, MAX_KIND_CHARS) ?? 'resource'
    const dedupeKey = `${kind}\0${uri}`

    const role =
      item.role === 'consulted' || item.role === 'cited' || item.role === 'discovered'
        ? item.role
        : 'discovered'
    const status = item.status === 'failed' ? 'failed' : 'available'
    const title = boundedString(item.title, MAX_TITLE_CHARS) ?? uri
    const id = boundedString(item.id, MAX_ID_CHARS) ?? agentSourceId(uri)
    const provider = boundedString(item.provider, MAX_PROVIDER_CHARS)
    const snippet = boundedString(item.snippet, MAX_SNIPPET_CHARS)
    const retrievedAt = boundedString(item.retrievedAt, 64)
    const metadata = metadataOf(item.metadata)

    const candidate: AgentSource = {
      id,
      kind,
      title,
      uri,
      role,
      status,
      ...(provider ? { provider } : {}),
      ...(snippet ? { snippet } : {}),
      ...(retrievedAt ? { retrievedAt } : {}),
      ...(metadata ? { metadata } : {}),
    }
    const existingIndex = indexByKey.get(dedupeKey)
    if (existingIndex !== undefined) {
      out[existingIndex] = mergeSource(out[existingIndex]!, candidate)
      continue
    }
    if (out.length >= limit) continue
    indexByKey.set(dedupeKey, out.length)
    out.push(candidate)
  }
  return out
}
