import { localixUriNamespace } from '../resource'
import { inertLine } from '../terminal-text'
import { utf8ByteLength } from '../utf8'
import type {
  ResourceExpansion,
  ResourceNode,
  ResourceNodeAction,
  ResourceRefProvider,
} from './resource-ref-contracts'

/** One response cap for every client. Menus may window visually, never discard differently. */
export const RESOURCE_BROWSE_LIMIT = 50
/** A provider is an untrusted plugin boundary: never inspect an unbounded row array. */
export const RESOURCE_PROVIDER_NODE_LIMIT = 1_000
/** Interactive browse and explicit expansion must not wait forever on a plugin. */
export const RESOURCE_PROVIDER_TIMEOUT_MS = 5_000
/** Direct `@resource:` expansion can bypass Context Fabric's per-provider budget. */
export const RESOURCE_EXPANSION_MAX_BYTES = 64 * 1024

export const RESOURCE_URI_MAX_CHARS = 4 * 1024
const RESOURCE_TITLE_MAX_CHARS = 256
export const RESOURCE_LABEL_MAX_CHARS = 512
const RESOURCE_DETAIL_MAX_CHARS = 2_000
const RESOURCE_ACTION_LIMIT = 16
const RESOURCE_ERROR_MAX_CHARS = 1_024
const EXPANSION_TRUNCATION_MARKER = '\n[resource expansion truncated]'

// Provider labels are provider-CONTROLLED text. Normalize presentation fields once at the
// server boundary (see `inertLine`) so every client sees the same inert, single-line
// contract instead of each having to be trusted to sanitize.
export const cleanPresentationText = (value: string, maxChars = RESOURCE_LABEL_MAX_CHARS): string =>
  inertLine(value, maxChars)

export const providerTitle = (provider: ResourceRefProvider): string =>
  cleanPresentationText(provider.title, RESOURCE_TITLE_MAX_CHARS)

// Resource tokens are whitespace-delimited. Providers must percent-encode path
// segments rather than mint an identity that the parser will silently truncate.
// oxlint-disable-next-line no-control-regex -- rejects C0/C1 token injection
const TOKEN_SAFE_URI = /^[^\s\x00-\x1f\x7f-\x9f]+$/
const PRESENTATION_TOKEN = /^[a-z0-9][a-z0-9._:-]{0,63}$/i

export const normalizeProviderNodes = (
  provider: ResourceRefProvider,
  value: unknown,
  limit: number,
): ResourceNode[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const nodes: ResourceNode[] = []
  // Bound work before touching plugin-owned fields. The browse response is capped
  // again later, but doing that only after normalization still lets one provider
  // force arbitrarily many copies, regex passes and sort entries.
  for (let index = 0; index < Math.min(value.length, limit); index += 1) {
    const candidate: unknown = value[index]
    if (!candidate || typeof candidate !== 'object') continue
    const node = candidate as ResourceNode
    // A provider may only mint identities in the provider it registered. This keeps
    // a broken/plugin-contributed tree from smuggling another provider's address
    // into the picker and preserves one owner for browse + expansion.
    if (
      typeof node.uri !== 'string' ||
      node.uri.length > RESOURCE_URI_MAX_CHARS ||
      !TOKEN_SAFE_URI.test(node.uri) ||
      localixUriNamespace(node.uri) !== provider.provider
    )
      continue
    if (seen.has(node.uri)) continue
    seen.add(node.uri)
    const label =
      typeof node.label === 'string'
        ? cleanPresentationText(node.label, RESOURCE_LABEL_MAX_CHARS)
        : ''
    if (!label || typeof node.hasChildren !== 'boolean') continue
    const detail =
      typeof node.detail === 'string'
        ? cleanPresentationText(node.detail, RESOURCE_DETAIL_MAX_CHARS) || undefined
        : undefined
    const group =
      typeof node.group === 'string'
        ? cleanPresentationText(node.group, RESOURCE_TITLE_MAX_CHARS) || undefined
        : undefined
    const actionIds = new Set<string>()
    const actions: ResourceNodeAction[] = []
    if (Array.isArray(node.actions)) {
      for (const action of node.actions.slice(0, RESOURCE_ACTION_LIMIT)) {
        if (
          action?.kind !== 'link' ||
          typeof action.id !== 'string' ||
          !PRESENTATION_TOKEN.test(action.id) ||
          actionIds.has(action.id) ||
          typeof action.label !== 'string'
        )
          continue
        const actionLabel = cleanPresentationText(action.label, RESOURCE_LABEL_MAX_CHARS)
        if (!actionLabel) continue
        actionIds.add(action.id)
        actions.push({ id: action.id, label: actionLabel, kind: 'link' })
      }
    }
    const icon =
      typeof node.icon === 'string' && PRESENTATION_TOKEN.test(node.icon) ? node.icon : undefined
    // Rebuild from the public contract instead of spreading a plugin-owned object.
    // Besides making runtime output match the TypeScript shape, this prevents an
    // accidental provider-only field (credentials, raw response metadata, etc.)
    // from crossing the shared browse boundary.
    const normalized: ResourceNode = {
      uri: node.uri,
      label,
      hasChildren: node.hasChildren,
      ...(detail ? { detail } : {}),
      ...(group ? { group } : {}),
      ...(actions.length ? { actions } : {}),
      ...(icon ? { icon } : {}),
      ...(node.notice === true ? { notice: true } : {}),
      ...(node.navigationOnly === true ? { navigationOnly: true } : {}),
    }
    nodes.push(normalized)
  }
  return nodes
}

export function positiveInteger(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`)
  }
  return resolved
}

/** Keep a string within a byte contract without cutting through a UTF-16 pair.
 *  Binary search only materializes prefixes no larger than the configured cap. */
function truncateUtf8(value: string, maxBytes: number): string {
  if (utf8ByteLength(value) <= maxBytes) return value
  const markerBytes = utf8ByteLength(EXPANSION_TRUNCATION_MARKER)
  if (markerBytes > maxBytes) return EXPANSION_TRUNCATION_MARKER.slice(0, maxBytes)
  const prefixBudget = Math.max(0, maxBytes - markerBytes)
  let low = 0
  let high = Math.min(value.length, prefixBudget)
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (utf8ByteLength(value.slice(0, middle)) <= prefixBudget) low = middle
    else high = middle - 1
  }
  if (low > 0 && /[\uD800-\uDBFF]/.test(value.charAt(low - 1))) low -= 1
  return `${value.slice(0, low)}${EXPANSION_TRUNCATION_MARKER}`
}

export function normalizeProviderExpansion(value: unknown, maxBytes: number): ResourceExpansion {
  if (!value || typeof value !== 'object') {
    return { ok: false, error: 'resource provider returned an invalid expansion' }
  }
  const expansion = value as ResourceExpansion
  if (expansion.ok) {
    const content =
      typeof expansion.content === 'string' ? truncateUtf8(expansion.content, maxBytes) : undefined
    const language =
      typeof expansion.language === 'string' && PRESENTATION_TOKEN.test(expansion.language)
        ? expansion.language
        : undefined
    return {
      ok: true,
      ...(content !== undefined ? { content } : {}),
      ...(language ? { language } : {}),
    }
  }
  const error =
    typeof expansion.error === 'string'
      ? cleanPresentationText(expansion.error, RESOURCE_ERROR_MAX_CHARS)
      : ''
  return { ok: false, error: error || 'resource unavailable' }
}
