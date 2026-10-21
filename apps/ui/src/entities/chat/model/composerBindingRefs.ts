import {
  clampSnippetContent,
  makeMessageRef,
  makeSnippetRef,
  messageRefFromRaw,
  parseContextRefs,
  snippetRefFromRaw,
  type ParsedContextRef,
} from '@localixai/api/context-refs'
import type { MessageContextBinding } from '@/shared/api/contracts'
import type { MessageContextBindingDraft } from '@localixai/plugin-sdk/ui'
import { promptHasToken } from '@localixai/plugin-sdk/ui/message-binding-drag'

/**
 * Parse ONE ready-made link token (`@file:src/a.ts`, `@resource:localix://resource/<provider>/…`,
 * `@message:<sid>/<mid>`) into a pinned-channel ref. Typed kinds go through the
 * registry parser; `@message:` (structured-only, never parseable) is
 * reconstructed from its synthetic raw. Null = not a recognizable link token
 * (the caller falls back to inserting the text).
 */
export function refFromToken(token: string): ParsedContextRef | null {
  return parseContextRefs(token)[0] ?? messageRefFromRaw(token)
}

/**
 * A composer ref that also carries the binding envelope it was reconstructed from.
 * Exported because it is the real return type of every `refFromContextBinding`-backed
 * builder below: callers (and their tests) must be able to read `messageBinding`
 * without a cast, while still passing the value anywhere a `ParsedContextRef` is taken.
 */
export type BindingBackedContextRef = ParsedContextRef & {
  /** Complete canonical envelope retained only inside the composer. `toWireRef`
   * intentionally ignores it; `resolveSendRefs` restores it onto the binding. */
  messageBinding?: {
    source?: MessageContextBinding['source']
    target: MessageContextBinding['target']
    assets?: MessageContextBinding['assets']
    plugin?: MessageContextBinding['plugin']
  }
}

const REF_ATTRIBUTE_KEYS = new Set([
  'path',
  'startLine',
  'endLine',
  'startColumn',
  'endColumn',
  'count',
  'sessionId',
  'projectId',
  'messageId',
  'terminalId',
  'toolCallId',
  'content',
  'language',
])

const CONTEXT_REF_LABEL_MAX = 512

function clampContextRefLabel(label: string): string {
  return label.length <= CONTEXT_REF_LABEL_MAX
    ? label
    : `${label.slice(0, CONTEXT_REF_LABEL_MAX - 1)}…`
}

/** Reconstruct the composer's editable ref from one durable message binding.
 * Merge the captured target metadata back over the grammar parse so structured
 * snippet/message fields and provider-owned URI attributes survive a return. */
export function refFromContextBinding(
  binding: Pick<MessageContextBinding, 'target'> &
    Partial<Pick<MessageContextBinding, 'source' | 'assets' | 'plugin'>>,
): BindingBackedContextRef {
  const label = clampContextRefLabel(binding.target.label)
  const attributes = binding.target.attributes ?? {}
  const parsed =
    refFromToken(binding.target.token) ??
    snippetRefFromRaw(binding.target.token) ??
    (binding.target.kind === 'snippet' && typeof attributes.content === 'string'
      ? makeSnippetRef({
          label,
          content: attributes.content,
          language: typeof attributes.language === 'string' ? attributes.language : undefined,
        })
      : binding.target.kind === 'message' &&
          typeof attributes.sessionId === 'string' &&
          typeof attributes.messageId === 'string'
        ? makeMessageRef({
            sessionId: attributes.sessionId,
            messageId: attributes.messageId,
            label,
          })
        : null)
  const safeAttributes = Object.fromEntries(
    Object.entries(attributes).filter(([key]) => REF_ATTRIBUTE_KEYS.has(key)),
  )
  if (typeof safeAttributes.content === 'string') {
    safeAttributes.content = clampSnippetContent(safeAttributes.content)
  }
  const canonicalAttributes = binding.target.attributes
    ? { ...binding.target.attributes }
    : undefined
  if (canonicalAttributes && typeof canonicalAttributes.content === 'string') {
    canonicalAttributes.content = clampSnippetContent(canonicalAttributes.content)
  }
  return {
    ...(parsed ?? {
      raw: binding.target.token,
      key: binding.target.token,
      // The wire schema leaves this extensible as `string`; the current composer
      // vocabulary is the narrower ParsedContextRef union.
      kind: binding.target.kind as ParsedContextRef['kind'],
    }),
    ...safeAttributes,
    ...(binding.target.uri ? { uri: binding.target.uri } : {}),
    label,
    messageBinding: {
      ...(binding.source ? { source: binding.source } : {}),
      ...(binding.assets?.length ? { assets: binding.assets } : {}),
      ...(binding.plugin ? { plugin: binding.plugin } : {}),
      // Clone the envelope: plugin-owned attributes remain opaque and intact,
      // while the local ParsedContextRef above receives only its safe known fields.
      target: {
        ...binding.target,
        label,
        // Structured-only drafts (snippet/message) have no text grammar and may
        // arrive with an empty drag token. Persist their synthetic stable raw id.
        token: binding.target.token || parsed?.raw || `@${binding.target.kind}:${label}`,
        ...(canonicalAttributes ? { attributes: canonicalAttributes } : {}),
      },
    },
  }
}

/** Convert plugin-owned context drafts into the same structured refs used by drag/drop. */
export function refsFromContextBindingDrafts(
  bindings: readonly MessageContextBindingDraft[],
): BindingBackedContextRef[] {
  const seen = new Set<string>()
  const refs: BindingBackedContextRef[] = []
  for (const binding of bindings) {
    const ref = refFromContextBinding(binding)
    if (seen.has(ref.key)) continue
    seen.add(ref.key)
    refs.push(ref)
  }
  return refs
}

type ContextBindingCandidate = {
  kind: string
  source?: MessageContextBinding['source']
  target?: MessageContextBinding['target']
  assets?: MessageContextBinding['assets']
  plugin?: MessageContextBinding['plugin']
}

/**
 * Context refs to re-stage when a failed/queued send returns to the composer.
 * A token already present in the restored text is represented by that text and
 * will be parsed again at send time; pinning it too would duplicate the ref and
 * could race the independent text restoration update.
 */
export function contextRefsMissingFromComposerText(
  text: string | undefined,
  bindings: readonly ContextBindingCandidate[] | undefined,
): BindingBackedContextRef[] {
  const parsedTokens = new Set(parseContextRefs(text ?? '').map((ref) => ref.raw))
  return (bindings ?? []).flatMap((binding) => {
    if (binding.kind !== 'context' || !binding.target) return []
    if (
      parsedTokens.has(binding.target.token) ||
      (text && promptHasToken(text, binding.target.token))
    ) {
      return []
    }
    return [
      refFromContextBinding({
        target: binding.target,
        ...(binding.source ? { source: binding.source } : {}),
        ...(binding.assets?.length ? { assets: binding.assets } : {}),
        ...(binding.plugin ? { plugin: binding.plugin } : {}),
      }),
    ]
  })
}
