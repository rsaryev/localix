/**
 * THE flattener for a model reply's `content` — every text block concatenated,
 * thinking/tool-call blocks ignored. One owner, because every consumer wants the
 * same thing and the interesting cases are all at the same boundary.
 *
 * WHY THE PARAMETER IS `unknown`. This runs at a PROVIDER BOUNDARY.
 * `AssistantMessage.content` is declared as a block array (`packages/agent/src/types.ts`),
 * but a runtime adapter or an aux one-shot can hand back a bare string,
 * `null`, or nothing at all — and at that boundary the declared type is precisely the
 * thing that cannot be trusted. Typing the parameter as the declared shape does not
 * make the runtime obey it; it only stops the callers who KNOW it lies from asking
 * this function for help. That is exactly what happened: the three chat aux callers
 * (session titling, the CC prompt-hook evaluator, the auto-mode permission classifier)
 * each take `unknown`, each must degrade to `''`, and so all three routed AROUND this
 * owner and hand-rolled their own copy. The duplication was the symptom; the narrow
 * contract was the disease.
 *
 * WHY NULLISH → `''` AND NOT `String(null)`. The old non-array branch was
 * `String(content)`, so an empty model reply flattened to the 4-character string
 * `"null"`. `"null"` is not blank, so it does not merely look wrong — it walks past
 * every guard written to catch an unusable reply with `!text.trim()`: session titling
 * would persist `"null"` as the session's NAME (`cleanGeneratedTitle(null) === ''` in
 * `chat/service/title-generation.ts` is the pinned behavior that stood between us and that).
 * An unusable reply must therefore be INDISTINGUISHABLE from an empty one: `''`.
 */

/** A text content block, as every provider wire shapes it. Structural, because at this
 *  boundary the block array's element type is not something we can take on faith. */
function isTextBlock(block: unknown): block is { type: 'text'; text: string } {
  return (
    !!block &&
    typeof block === 'object' &&
    (block as { type?: unknown }).type === 'text' &&
    typeof (block as { text?: unknown }).text === 'string'
  )
}

/**
 * `content` → its concatenated text.
 *
 * A block array yields its text blocks joined; a bare string passes through (some
 * providers hand one back instead of the array); a nullish or otherwise unusable reply
 * degrades to `''` so the caller can take its fail-safe path. Anything else is
 * last-resort JSON-encoded rather than dropped, so a genuinely novel shape shows up in
 * the output instead of vanishing.
 */
export function assistantText(content: unknown): string {
  if (Array.isArray(content)) {
    return content.flatMap((block) => (isTextBlock(block) ? [block.text] : [])).join('')
  }
  if (content == null) return ''
  if (typeof content === 'string') return content
  try {
    return JSON.stringify(content) ?? ''
  } catch {
    return ''
  }
}
