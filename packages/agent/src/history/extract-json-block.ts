/**
 * Find the JSON object a model meant to hand back, inside prose it also wrote.
 *
 * Lenient about FORM, strict about MEANING — the contract `features/loops` arrived at and
 * the one generalized here. A model asked for a fenced JSON block will sometimes label the
 * fence, sometimes not, sometimes explain itself before and after it, and sometimes emit two
 * blocks because it revised. None of that is a refusal, so none of it should read as one.
 * But a block that parses and does not mean what was asked IS a refusal, and guessing at it
 * is worse than reporting nothing: a fabricated status is acted on, an absent one is not.
 *
 * Search order is last-first. When a model revises itself the later block is the answer, and
 * an example quoted from the prompt is almost always earlier than the reply.
 *
 * This module only finds and parses. Validating the object against a schema, clamping its
 * fields and deciding what an invalid one means belong to the caller, which is the half that
 * knows what it asked for.
 */

/** A JSON object recovered from model text, plus how it was found. */
export interface ExtractedJson {
  value: Record<string, unknown>
  /** `fence` came from a ``` block, `bare` from a balanced object in the prose. */
  source: 'fence' | 'bare'
  /** The exact text that parsed, for a diagnostic that quotes what it read. */
  raw: string
}

const FENCE = /```(?:json|jsonc)?\s*([\s\S]*?)```/gu

/**
 * Every candidate block in `text`, most likely first. Exposed because a caller that accepts
 * only some shapes (a specific `status`, a required field) must be able to keep looking:
 * taking the first block that merely PARSES would let a quoted example beat the real answer.
 */
export function* jsonCandidates(
  text: string,
): Generator<{ raw: string; source: 'fence' | 'bare' }> {
  const fences = [...text.matchAll(FENCE)].map((match) => match[1] ?? '')
  for (const fence of fences.reverse()) yield { raw: fence, source: 'fence' }

  // Unfenced fallback: the last balanced object in the text. Scanning back from the final
  // `}` and counting depth finds the object's own opening brace rather than the first `{`
  // in the message, which in a reply that mentions `{}` in prose is not the same thing.
  const end = text.lastIndexOf('}')
  if (end === -1) return
  let depth = 0
  for (let i = end; i >= 0; i -= 1) {
    if (text[i] === '}') depth += 1
    else if (text[i] === '{') {
      depth -= 1
      if (depth === 0) {
        yield { raw: text.slice(i, end + 1), source: 'bare' }
        return
      }
    }
  }
}

/**
 * The first candidate that parses as a JSON OBJECT and passes `accept`.
 *
 * `accept` is where the caller's meaning goes. Without it this returns the last object in
 * the text, which is right for a reply that carries exactly one; with it, a caller can skip
 * an example, a partial revision, or a block missing the field that makes it an answer.
 */
export function extractJsonBlock(
  text: string,
  accept?: (value: Record<string, unknown>) => boolean,
): ExtractedJson | undefined {
  for (const candidate of jsonCandidates(text)) {
    const value = parseObject(candidate.raw)
    if (!value) continue
    if (accept && !accept(value)) continue
    return { value, source: candidate.source, raw: candidate.raw.trim() }
  }
  return undefined
}

function parseObject(raw: string): Record<string, unknown> | undefined {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{')) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return undefined
  }
  // An array or a bare scalar parses fine and is never what was asked for.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  return parsed as Record<string, unknown>
}
