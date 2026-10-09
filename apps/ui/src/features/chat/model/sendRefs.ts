/**
 * Pure send-time merge for composer context refs — kept out of the React hook
 * (`useContextRefs`) so it's unit-testable without rendering.
 *
 * Two channels feed a send:
 *  - TEXT refs — parsed from the prompt (`@file:` / `@session:` / …); their expanded
 *    size is measured server-side (the budget dry-run).
 *  - PINNED refs — structured refs with NO prompt token, added by the @-menu,
 *    drag/drop, or the composerBus (ANY kind — file/session/resource/…, plus the
 *    structured-only `snippet`/`message`). An inline-content kind (`snippet`) is
 *    sized LOCALLY; every other pinned kind is preflight-sized server-side like a
 *    text ref. Pinned refs always ride the send regardless of project/session scope.
 *
 * `resolveSendRefs` unions the two, applies the budget gate over the combined size,
 * and yields the wire refs (or null when the budget blocks the send).
 */
import {
  clampSnippetContent,
  classifyExpansionBudget,
  makeMessageRef,
  makeSnippetRef,
  messageRefFromRaw,
  parseContextRefs,
  snippetRefFromRaw,
  type ContextRefKind,
  type ParsedContextRef,
} from '@localixai/api/context-refs'
import { COMPLETION_REFERENCE_LIMIT } from '@localixai/api/inline-completion-contracts'
import type { CompletionReference } from '@localixai/api/client'
import { boundCompletionReference } from '@/shared/api/completionWorkingSet'
import type { MessageContextBinding } from '@/shared/api/contracts'
import type { MessageContextBindingDraft } from '@localixai/plugin-sdk/ui'
import { promptHasToken } from '@localixai/plugin-sdk/ui/message-binding-drag'
import { contextTargetFromRef } from './contextLinks'

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

/** Kinds whose content is carried inline on the ref (no server round-trip to size). */
const INLINE_CONTENT_KINDS: ReadonlySet<ContextRefKind> = new Set<ContextRefKind>(['snippet'])

/**
 * Server cap on context bindings per message — mirrors `sendMessageRequestSchema.bindings`
 * (`.max(20)` in `apps/api/src/features/chat/contracts.ts`). A 21st binding would fail
 * the WHOLE send at schema parse, so the composer caps client-side: pinned refs
 * first (drag-added, deliberate), then the earliest text refs.
 */
export const MAX_SEND_REFS = 20

/**
 * The composer's OWN chips as completion references — what the user deliberately linked, pinned
 * refs first, then typed ones, duplicates collapsed by canonical key.
 *
 * Ambient (open-tab) refs are not here any more: every completion surface gets those from the
 * shared working set (`shared/api/completionWorkingSet.ts`), so the composer no longer carries a
 * private copy of what the grid already knows. The target is built by the same one ref → target
 * conversion a sent message uses, so a completion and the message resolve the same reference.
 */
export function inlineCompletionReferences(input: {
  pinnedRefs: readonly ParsedContextRef[]
  textRefs: readonly ParsedContextRef[]
}): CompletionReference[] {
  const seen = new Set<string>()
  const references: CompletionReference[] = []
  for (const ref of [...input.pinnedRefs, ...input.textRefs]) {
    if (references.length >= COMPLETION_REFERENCE_LIMIT) break
    if (seen.has(ref.key)) continue
    seen.add(ref.key)
    const target =
      (ref as BindingBackedContextRef).messageBinding?.target ?? contextTargetFromRef(ref)
    references.push(
      boundCompletionReference({
        kind: target.kind,
        token: target.token,
        label: target.label,
        ...(target.uri ? { uri: target.uri } : {}),
        ...(target.attributes ? { attributes: target.attributes } : {}),
        origin: 'linked',
      }),
    )
  }
  return references
}

/** How many of the given refs the 20-ref wire cap would drop (chip-row hint). */
export function droppedRefCount(textCount: number, pinnedCount: number): number {
  return Math.max(0, textCount + pinnedCount - MAX_SEND_REFS)
}

/**
 * Whether ONE ambient (tab-derived) ref should ride alongside the manual channels.
 * Ambient means nobody asked for it, so it always YIELDS to a deliberate duplicate:
 * a manual pinned ref with the same key, or a hand-typed token with the same key
 * that is not excluded. Null = contribute nothing (dedup, or no auto ref at all).
 */
export function includeAutoRef(
  auto: ParsedContextRef | null | undefined,
  textRefs: readonly ParsedContextRef[],
  excluded: ReadonlySet<string>,
  pinnedRefs: readonly ParsedContextRef[],
): ParsedContextRef | null {
  if (!auto) return null
  if (pinnedRefs.some((r) => r.key === auto.key)) return null
  if (textRefs.some((r) => r.key === auto.key && !excluded.has(r.key))) return null
  return auto
}

/**
 * The same rule over the N ambient candidates the grid offers, plus the one conflict a
 * single ref cannot have: two ambient candidates resolving to the SAME ref.
 *
 * That happens for real — the same file open in two groups, or a tab re-homed while its
 * id lingers in another group's MRU — and a duplicate would double-expand one file. The
 * EARLIER candidate wins, which is why the caller's order matters: `activeTabLinks`
 * yields freshest-first, so the copy that survives is the one the user touched last.
 */
export function includeAutoRefs(
  autos: readonly ParsedContextRef[],
  textRefs: readonly ParsedContextRef[],
  excluded: ReadonlySet<string>,
  pinnedRefs: readonly ParsedContextRef[],
): ParsedContextRef[] {
  const out: ParsedContextRef[] = []
  const seen = new Set<string>()
  for (const auto of autos) {
    if (seen.has(auto.key)) continue
    if (!includeAutoRef(auto, textRefs, excluded, pinnedRefs)) continue
    seen.add(auto.key)
    out.push(auto)
  }
  return out
}

/** A ref whose content travels on the ref itself (drag/attach-added, token-less). */
export function isInlineContentRef(ref: ParsedContextRef): boolean {
  return INLINE_CONTENT_KINDS.has(ref.kind)
}

/** Local expanded-char size of inline-content (pinned) refs — no fetch needed. */
export function inlineRefChars(refs: ParsedContextRef[]): number {
  let total = 0
  for (const ref of refs) total += ref.content?.length ?? 0
  return total
}

export interface ResolveSendRefsInput {
  /** Prompt-parsed refs (already excluded-filtered). */
  textRefs: ParsedContextRef[]
  /** Structured drag-added refs with no prompt token (e.g. snippets). */
  pinnedRefs: ParsedContextRef[]
  /**
   * AMBIENT refs (derived from the open tabs), freshest first. Their own channel
   * because the wire cap must shed THEM first: nothing derived may displace a ref the
   * user added by hand. Already deduped against the manual channels by
   * {@link includeAutoRefs}; re-filtered here so the cap holds for any caller.
   */
  autoRefs?: ParsedContextRef[]
  /** Expanded chars already known for the MANUAL server-sized refs — text refs
   * and pinned non-inline refs (from the size dry-run cache). */
  knownTextChars: number
  /** Per-ref estimates for ambient candidates. An ambient ref that would cross
   * the hard budget is omitted instead of blocking the user's message. */
  autoRefChars?: ReadonlyMap<string, number>
  /** Model context window (tokens) for the budget gate; undefined → 128k fallback. */
  contextTokens: number | undefined
}

/**
 * Merge text + pinned + ambient refs into the wire payload, gated by the size budget.
 * Pinned (inline-content) refs are always included — their size is known locally, so
 * they ride even with no project/session scope. Returns null when the combined size
 * blocks the send; an empty array when there are no refs at all.
 *
 * The cap sheds in reverse order of deliberateness — ambient first, then typed tokens,
 * and pinned refs last — so a full composer never spends its last wire slots on
 * something the user did not ask for.
 */
export function resolveSendRefs(input: ResolveSendRefsInput): MessageContextBinding[] | null {
  // Wire cap (server schema max 20): keep ALL pinned refs (drag/menu-added,
  // deliberate), fill the rest with the earliest text refs. A text token whose
  // key is also pinned is dropped (one ref, not a double expansion).
  const pinned = input.pinnedRefs.slice(0, MAX_SEND_REFS)
  const pinnedKeys = new Set(pinned.map((r) => r.key))
  const textRefs = input.textRefs
    .filter((r) => !pinnedKeys.has(r.key))
    .slice(0, MAX_SEND_REFS - pinned.length)
  // Ambient refs take only the slots the manual channels left. Sending them FIRST (as
  // this did while there was exactly one) let three open tabs push three hand-added
  // links off a full message.
  const taken = new Set([...pinnedKeys, ...textRefs.map((r) => r.key)])
  const manualChars = input.knownTextChars + inlineRefChars(pinned)
  if (classifyExpansionBudget(manualChars, input.contextTokens) === 'block') return null
  const autoRefs: ParsedContextRef[] = []
  let admittedChars = manualChars
  const autoSlots = Math.max(0, MAX_SEND_REFS - pinned.length - textRefs.length)
  for (const ref of input.autoRefs ?? []) {
    if (autoRefs.length >= autoSlots) break
    if (taken.has(ref.key)) continue
    const nextChars = admittedChars + (input.autoRefChars?.get(ref.key) ?? 0)
    // Ambient context is a best-effort guess. Crossing the hard budget drops this
    // candidate (and continues to a potentially smaller one); it never blocks send.
    if (classifyExpansionBudget(nextChars, input.contextTokens) === 'block') continue
    autoRefs.push(ref)
    taken.add(ref.key)
    admittedChars = nextChars
  }
  const all = [...textRefs, ...pinned, ...autoRefs]
  if (all.length === 0) return []
  return all.map((ref) => {
    const canonical = (ref as BindingBackedContextRef).messageBinding
    return {
      kind: 'context',
      id: crypto.randomUUID(),
      source: canonical?.source ?? 'mention',
      ...(canonical?.assets?.length ? { assets: canonical.assets } : {}),
      ...(canonical?.plugin ? { plugin: canonical.plugin } : {}),
      // One ref → target conversion, shared with a pasted link's (`contextLinks.ts`).
      target: canonical?.target ?? contextTargetFromRef(ref),
      resolution: { status: 'pending', contributions: [] },
    }
  })
}
