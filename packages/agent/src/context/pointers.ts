/**
 * THE pointer left in place of an elided READ result — one owner, for both compression
 * layers.
 *
 * A pointer is not a placeholder. It is the model's ONLY route back to content that was
 * on the wire a moment ago and is not any more, so its words decide what the model does
 * next: replay the bytes for one turn (cheap), re-read the file (expensive, and it
 * re-bills every turn afterwards — the endless-review loop), or neither.
 * Which of the three is CORRECT depends on the read's {@link ReadFate}, and getting it
 * wrong is not cosmetic: offering `tool_output` on a STALE read hands the model bytes
 * that no longer exist on disk, and it has no way to know.
 *
 * The two layers elide the same reads for the same reasons — turn-start VBC (`apply.ts`)
 * and the per-request wire prune (`prune-wire.ts`) — and each had its own verbatim copy of
 * all three strings. A copy is not a style problem here: fix the stale-read wording in one
 * layer and the model gets different, contradictory recovery advice depending on which
 * layer happened to elide the read. Nothing type-checks a template literal, and no test
 * covered the prose.
 *
 * Every string below carries {@link ELISION_MARKER} by INTERPOLATION, never by re-typing
 * the phrase — that marker is what makes compression idempotent and what tells a host
 * whether the model can still see a result. See its declaration in `op-menu.ts`.
 */
import type { ReadFate } from './live-reads'
import { ELISION_MARKER } from './op-menu'
import { hintClause } from './vocab-hints'

/**
 * The pointer for an elided READ result.
 *
 * - `live` — the bytes still describe the file, so advertise the cheap one-turn replay.
 *   Without a `locator` (no `tool_call_id` to hand back) there is no handle, so the only
 *   recovery left is a re-read.
 * - `stale` — a later write CHANGED the file. A replay would faithfully reproduce content
 *   that is gone; the handle must NOT be offered.
 * - `refreshed` — the model already re-read the file, so the current bytes are further
 *   down this very conversation. Neither a replay nor a re-read is needed.
 */
export function readPointer(
  fate: ReadFate,
  chars: number,
  locator?: string,
  source?: string,
  recoveryToolAvailable = true,
): string {
  if (fate === 'stale') {
    // No hints here, deliberately. Hints exist to aim a follow-up AT the elided content;
    // this content is gone from disk, and naming its vocabulary would invite exactly the
    // replay the rest of this sentence forbids.
    return (
      `[output ${ELISION_MARKER} — ${chars} chars, and the file has CHANGED since this read; ` +
      `do NOT replay it — read the file again if you need its current content]`
    )
  }
  if (fate === 'refreshed') {
    // Nor here: the current bytes are further down this same conversation, so the useful
    // follow-up is "look below", not "query the elided copy".
    return (
      `[output ${ELISION_MARKER} — ${chars} chars; a NEWER read of the same file appears later ` +
      `in this conversation — use that]`
    )
  }
  return elidedPointer('output', chars, locator, source, recoveryToolAvailable)
}

/**
 * The route back to a whole MESSAGE that left the model's view — its text folded, or the message
 * evicted into an epoch card. The message is durable in the transcript and `history_search`
 * scrolls to it by id, so naming the id IS the recovery. Without the recall tool in this run's
 * roster the pointer must not advertise a call the model cannot make.
 */
export function messageRecallClause(messageId: string, recallToolAvailable = true): string {
  return recallToolAvailable
    ? `; history_search(around_message_id="${messageId}") shows it in full`
    : ''
}

/**
 * The gap line a FOLDED message text carries in place of its middle. It interpolates
 * {@link ELISION_MARKER} inside an open bracket, so every later pass recognises the text as
 * already compressed and never folds a fold.
 */
export function foldedTextMarker(
  omittedChars: number,
  messageId: string | undefined,
  recallToolAvailable = true,
): string {
  const recall = messageId ? messageRecallClause(messageId, recallToolAvailable) : ''
  return `\n[… ${omittedChars} chars ${ELISION_MARKER}${recall} …]\n`
}

/**
 * The pointer for any elided RECOVERABLE payload, named by `label` — a read result
 * (`output`) or a heavy mutate ARG (`content` / `patch` / `edits` / `old_string` / …).
 *
 * Prefers the `tool_output` handle — a cheap one-turn replay of exactly this result —
 * over "re-read the file", which re-lands the whole file in full and re-bills it every
 * turn until it ages out again. The bare re-read hint is the fallback for when no
 * `tool_call_id` is known.
 *
 * `source` — the text being elided — buys a few DISTINCTIVE terms from it (see
 * `vocab-hints.ts`), so the follow-up that recovers or searches this content is aimed with
 * vocabulary that provably occurs in it instead of vocabulary the model guessed. Omitted, or
 * on a body too small for the hints to pay for themselves, the pointer is byte-identical to
 * what it has always been.
 */
export function elidedPointer(
  label: string,
  chars: number,
  locator?: string,
  source?: string,
  recoveryToolAvailable = true,
): string {
  const hints = source ? hintClause(source) : ''
  return locator && recoveryToolAvailable
    ? `[${label} ${ELISION_MARKER} — ${chars} chars; recover the exact bytes via ` +
        `tool_output(action="get", tool_call_id="${locator}") — a cheap one-turn replay — or re-read the ` +
        `file only if it may have changed since${hints}]`
    : `[${label} ${ELISION_MARKER} — ${chars} chars; re-read the file/source if needed${hints}]`
}
