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
  classifyExpansionBudget,
  type ContextRefKind,
  type ParsedContextRef,
} from '@localixai/api/context-refs'
import { COMPLETION_REFERENCE_LIMIT } from '@localixai/api/inline-completion-contracts'
import type { CompletionReference } from '@localixai/api/client'
import { boundCompletionReference } from '@/shared/api/completionWorkingSet'
import type { MessageContextBinding } from '@/shared/api/contracts'
import { contextTargetFromRef } from './contextLinks'
import type { BindingBackedContextRef } from './composerBindingRefs'

export {
  refFromToken,
  refFromContextBinding,
  refsFromContextBindingDrafts,
  contextRefsMissingFromComposerText,
  type BindingBackedContextRef,
} from './composerBindingRefs'

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
