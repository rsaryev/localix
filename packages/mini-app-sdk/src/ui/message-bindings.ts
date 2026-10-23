/**
 * THE MESSAGE-BINDING VOCABULARY — what a mini app can attach to a chat message, and how the
 * composer describes it.
 *
 * Split out of `contrib.ts`, which had grown to hold two unrelated vocabularies: the shapes a
 * mini app REGISTERS with the host (tabs, rail entries, slots) and the shapes it SENDS through the
 * composer. They are edited by different work and read by different readers. `contrib.ts`
 * re-exports everything here, so `@localixai/mini-app-sdk/ui` is unchanged.
 */
import type { MessageAttachment } from '@localixai/agent'
import type { AddressableResource } from '../resource'

/** What kind of thing a tab drag links into the composer. `snippet` is the token-less
 *  inline-content kind — it drops as a structured context-ref carrying its own content. */
export type MessageBindingTargetKind =
  | 'file'
  | 'session'
  | 'project'
  | 'message'
  | 'terminal'
  | 'call'
  | 'resource'
  | 'snippet'

/**
 * Architecture-neutral draft used by both mini app and core drag/link producers.
 * The host serializes this exact shape; no mini-app-to-core adapter is required.
 */
export interface MessageContextBindingDraft {
  kind: 'context'
  source: 'drag' | 'active-tab' | 'mini-app'
  /** Optional media/file evidence that travels atomically with this context. */
  assets?: MessageAttachment[]
  /**
   * HOST-minted: the mini app whose open tab this context came from, so the turn answering the
   * message carries that mini app's tools. The host sets it from the tab's owner and overwrites
   * whatever a mini app's draft says.
   */
  miniApp?: string
  target: {
    kind: MessageBindingTargetKind
    token: string
    label: string
    uri?: string
    attributes?: Record<string, string | number | boolean>
  }
}

/**
 * Live context facets published by a mounted work-item body.
 *
 * A static {@link WorkItemKindContribution.toMessageBinding} is enough for a tab whose
 * meaning never changes (for example a database table). Interactive tabs often have a
 * narrower live meaning: a pod's Logs view, a chart's selected timeframe, or a REST
 * response currently being inspected. Those components publish their current facets
 * through the host-injected `publishMessageContext` prop.
 *
 * `replace` says the live facets are a more precise view of the static tab binding.
 * `append` keeps the static binding and adds UI-state facets beside it. The host owns
 * dedupe, ranking, budgets, lifecycle cleanup and capture; mini apps still own only opaque
 * binding drafts and never import a chat/composer store.
 */
/** Runtime-published mini app state uses only provider-owned resources or bounded
 * snapshots. Other binding kinds remain available to host/static producers. */
export type PublishedMessageContextBindingDraft = MessageContextBindingDraft & {
  target: MessageContextBindingDraft['target'] & { kind: 'resource' | 'snippet' }
}

export interface PublishedMessageContext {
  strategy: 'replace' | 'append'
  bindings: readonly PublishedMessageContextBindingDraft[]
}

/** Maximum independently-resolvable facets one mounted tab may advertise. */
export const PUBLISHED_MESSAGE_CONTEXT_MAX_BINDINGS = 5

/** Host callback injected into contributed work-item components. Passing `null`
 * removes the publication; the host also removes it automatically on unmount. */
export type PublishMessageContext = (context: PublishedMessageContext | null) => void

/**
 * Pre-persistence binding vocabulary used at UI contribution boundaries. Assets
 * already have their complete wire shape; context links use an unresolved draft
 * that the host turns into a captured `MessageContextBinding` on acceptance.
 */
export type MessageBindingDraft = MessageAttachment | MessageContextBindingDraft

/** Canonical resource → message-binding adapter shared by core and mini app UI. */
export function resourceMessageBindingDraft(
  resource: Pick<AddressableResource, 'uri' | 'label'>,
  source: MessageContextBindingDraft['source'] = 'mini-app',
): PublishedMessageContextBindingDraft {
  return {
    kind: 'context',
    source,
    target: {
      kind: 'resource',
      token: `@resource:${resource.uri}`,
      label: resource.label,
      uri: resource.uri,
    },
  }
}

/** UI-state snapshots are intentionally much smaller than the server's absolute
 * snippet wire cap: this value also bounds the process-local live-tab registry. */
export const LIVE_SNIPPET_CONTENT_MAX = 40_000
const LIVE_SNIPPET_TRUNCATION_NOTE = '\n… [live context snapshot truncated]'
/**
 * Live mini app state may either address a provider-owned opaque resource or carry
 * a bounded ephemeral snapshot. Core-owned targets (`file`, `terminal`, `task`,
 * …) are intentionally excluded: accepting them from an iframe would let a
 * mini app impersonate a host capability instead of registering its own URI.
 */
const PUBLISHED_MESSAGE_CONTEXT_TARGET_KINDS: ReadonlySet<string> = new Set(['resource', 'snippet'])
const PUBLISHED_CONTEXT_ASSET_MAX = 8
const PUBLISHED_CONTEXT_ASSET_DATA_MAX = 8 * 1024 * 1024

function normalizeContextAsset(value: unknown): MessageAttachment | null {
  if (typeof value !== 'object' || value === null) return null
  const asset = value as Record<string, unknown>
  if (typeof asset.kind !== 'string' || typeof asset.name !== 'string') return null
  if (typeof asset.size !== 'number' || !Number.isSafeInteger(asset.size) || asset.size < 0)
    return null
  // Sandboxed mini apps may publish bytes or an already-hosted media id, never a
  // host filesystem path.
  if (asset.kind === 'path') return null
  if (asset.kind === 'text') {
    return typeof asset.text === 'string' && asset.text.length <= LIVE_SNIPPET_CONTENT_MAX
      ? (asset as unknown as MessageAttachment)
      : null
  }
  if (!['image', 'video', 'file', 'audio'].includes(asset.kind)) return null
  if (typeof asset.mediaType !== 'string') return null
  if (asset.data !== undefined && typeof asset.data !== 'string') return null
  if (asset.mediaId !== undefined && typeof asset.mediaId !== 'string') return null
  if (typeof asset.data === 'string' && asset.data.length > PUBLISHED_CONTEXT_ASSET_DATA_MAX)
    return null
  if (!asset.data && !asset.mediaId) return null
  return asset as unknown as MessageAttachment
}

/** Canonical bounded-inline context draft for UI state that has no provider URI
 * (for example a chart configuration or an unsaved editor draft). The host clamps
 * content to its wire limit before persistence. */
export function snippetMessageBindingDraft(
  input: { label: string; content: string; language?: string },
  source: MessageContextBindingDraft['source'] = 'mini-app',
): PublishedMessageContextBindingDraft {
  const label = input.label.trim() || 'snippet'
  const content =
    input.content.length <= LIVE_SNIPPET_CONTENT_MAX
      ? input.content
      : input.content.slice(0, LIVE_SNIPPET_CONTENT_MAX - LIVE_SNIPPET_TRUNCATION_NOTE.length) +
        LIVE_SNIPPET_TRUNCATION_NOTE
  return {
    kind: 'context',
    source,
    target: {
      kind: 'snippet',
      token: `@snippet:${label}`,
      label,
      attributes: {
        content,
        ...(input.language ? { language: input.language } : {}),
      },
    },
  }
}

/**
 * Validate and normalize an untrusted live-context publication (notably one
 * crossing the sandboxed mini app iframe bridge). Returns null for an invalid
 * envelope. The host, not the mini app, mints provenance; URI namespaces stay opaque.
 */
export function normalizePublishedMessageContext(value: unknown): PublishedMessageContext | null {
  if (typeof value !== 'object' || value === null) return null
  const input = value as Record<string, unknown>
  if (input.strategy !== 'replace' && input.strategy !== 'append') return null
  if (
    !Array.isArray(input.bindings) ||
    input.bindings.length < 1 ||
    input.bindings.length > PUBLISHED_MESSAGE_CONTEXT_MAX_BINDINGS
  ) {
    return null
  }
  const bindings: PublishedMessageContextBindingDraft[] = []
  for (const candidate of input.bindings) {
    if (typeof candidate !== 'object' || candidate === null) return null
    const targetValue = (candidate as Record<string, unknown>).target
    if (typeof targetValue !== 'object' || targetValue === null) return null
    const target = targetValue as Record<string, unknown>
    if (
      typeof target.kind !== 'string' ||
      !PUBLISHED_MESSAGE_CONTEXT_TARGET_KINDS.has(target.kind) ||
      typeof target.token !== 'string' ||
      target.token.length < 1 ||
      target.token.length > 4096 ||
      typeof target.label !== 'string' ||
      target.label.trim().length < 1 ||
      target.label.length > 512 ||
      (target.uri !== undefined &&
        (typeof target.uri !== 'string' || target.uri.length < 1 || target.uri.length > 4096))
    ) {
      return null
    }
    const rawAttributes = target.attributes
    let attributes: Record<string, string | number | boolean> | undefined
    if (rawAttributes !== undefined) {
      if (typeof rawAttributes !== 'object' || rawAttributes === null) return null
      const entries = Object.entries(rawAttributes)
      if (entries.length > 32) return null
      attributes = {}
      for (const [key, attribute] of entries) {
        if (
          key.length < 1 ||
          key.length > 64 ||
          (typeof attribute !== 'string' &&
            typeof attribute !== 'number' &&
            typeof attribute !== 'boolean') ||
          (typeof attribute === 'number' && !Number.isFinite(attribute))
        ) {
          return null
        }
        attributes[key] =
          typeof attribute === 'string' && attribute.length > LIVE_SNIPPET_CONTENT_MAX
            ? attribute.slice(0, LIVE_SNIPPET_CONTENT_MAX - LIVE_SNIPPET_TRUNCATION_NOTE.length) +
              LIVE_SNIPPET_TRUNCATION_NOTE
            : attribute
      }
    }
    if (target.kind === 'resource' && typeof target.uri !== 'string') return null
    if (
      target.kind === 'snippet' &&
      (typeof attributes?.content !== 'string' || attributes.content.length < 1)
    ) {
      return null
    }
    const rawAssets = (candidate as Record<string, unknown>).assets
    let assets: MessageAttachment[] | undefined
    if (rawAssets !== undefined) {
      if (!Array.isArray(rawAssets) || rawAssets.length > PUBLISHED_CONTEXT_ASSET_MAX) return null
      assets = []
      for (const rawAsset of rawAssets) {
        const asset = normalizeContextAsset(rawAsset)
        if (!asset) return null
        assets.push(asset)
      }
    }
    bindings.push({
      kind: 'context',
      source: 'mini-app',
      ...(assets?.length ? { assets } : {}),
      target: {
        kind: target.kind as PublishedMessageContextBindingDraft['target']['kind'],
        token: target.kind === 'resource' ? `@resource:${target.uri as string}` : target.token,
        label: target.label.trim(),
        ...(typeof target.uri === 'string' ? { uri: target.uri } : {}),
        ...(attributes ? { attributes } : {}),
      },
    })
  }
  return { strategy: input.strategy, bindings }
}
