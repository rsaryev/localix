import type { CatalogModel } from '@/shared/hooks/useModelsCatalog'

/**
 * Pick a sensible DEFAULT chat model for a freshly connected provider.
 *
 * A provider can expose hundreds of catalog entries — embeddings, transcription,
 * image models, and years of superseded chat models all in one list. A user who
 * just connected has no way to know which of those actually drives an agent, so
 * onboarding offers one pre-vetted pick they can accept in a click (the full
 * picker stays right there for anyone who wants to choose themselves).
 *
 * The ranking is deliberately catalog-only — no network probe, no hardcoded
 * model names to go stale. It rewards what an agent needs (tool calling first,
 * then reasoning and attachments), prefers recent releases and roomy context,
 * and mildly discounts the most expensive tiers so the default is a workhorse
 * rather than the priciest flagship.
 */

/**
 * Modalities/ids that are never a chat model, however capable they look. Long stems match
 * anywhere; short or common words must stand as their own id segment, so `llama-guard-3` and
 * `mistral-ocr` are excluded while a name merely containing the letters (`vanguard`,
 * `procrustes`) is not.
 */
const NON_CHAT_PATTERN =
  /embed|rerank|moderation|whisper|transcrib|(?:^|[-_ ./:])(?:tts|speech|guard|ocr)(?:[-_ ./:\d]|$)/i

function isChatCandidate(model: CatalogModel): boolean {
  if (NON_CHAT_PATTERN.test(model.id) || NON_CHAT_PATTERN.test(model.name)) return false
  // A chat model must be able to answer in text; image/video generators can't.
  if (model.outputModalities.length > 0 && !model.outputModalities.includes('text')) return false
  return true
}

/** Newer is better, but only as a bounded nudge — 0 for an undated model. */
function recencyScore(releaseDate: string | undefined): number {
  if (!releaseDate) return 0
  const released = Date.parse(releaseDate)
  if (Number.isNaN(released)) return 0
  const monthsOld = (Date.now() - released) / (1000 * 60 * 60 * 24 * 30.4)
  if (monthsOld < 0) return 6 // announced ahead of its date — still the newest thing
  return Math.max(0, 6 - monthsOld / 4)
}

/** Discount runaway pricing so the default is affordable to actually use. */
function costScore(model: CatalogModel): number {
  const input = model.cost?.input
  if (input == null) return 0
  if (input <= 1) return 2
  if (input <= 5) return 1
  if (input <= 15) return 0
  return -2
}

function contextScore(contextLength: number | undefined): number {
  if (!contextLength) return 0
  if (contextLength >= 400_000) return 2
  if (contextLength >= 180_000) return 1.5
  if (contextLength >= 100_000) return 1
  if (contextLength >= 32_000) return 0.5
  return 0
}

/**
 * Reduced-capability siblings of a flagship. Cheapness already earns points, so
 * without this the discount alone would nominate the mini variant as the default
 * for a first session — a downgrade the user never asked for.
 */
const TRIMMED_VARIANT = /(^|[-_ .])(mini|nano|lite|small|tiny|instant|flash-?8b)([-_ .]|$)/i

/** Capability points: tool calling dominates because it is what makes a model an agent. */
const CAPABILITY_WEIGHT = { tools: 8, reasoning: 2, attachment: 1 } as const
/** Penalty for a reduced-capability sibling (`TRIMMED_VARIANT`). */
const TRIMMED_VARIANT_PENALTY = -3

function score(model: CatalogModel): number {
  return (
    (model.supportsTools ? CAPABILITY_WEIGHT.tools : 0) +
    (model.supportsReasoning ? CAPABILITY_WEIGHT.reasoning : 0) +
    (model.supportsAttachment ? CAPABILITY_WEIGHT.attachment : 0) +
    recencyScore(model.releaseDate) +
    contextScore(model.contextLength) +
    costScore(model) +
    (TRIMMED_VARIANT.test(model.id) || TRIMMED_VARIANT.test(model.name)
      ? TRIMMED_VARIANT_PENALTY
      : 0)
  )
}

/** Short, honest justification for the pick — shown next to the suggestion. */
export function recommendationReason(model: CatalogModel): string {
  const traits: string[] = []
  if (model.supportsTools) traits.push('tool calling')
  if (model.supportsReasoning) traits.push('reasoning')
  if (model.supportsAttachment) traits.push('attachments')
  if (traits.length === 0) return 'Most capable model on this connection'
  return `Supports ${traits.join(' · ')}`
}

/**
 * The best default among `models` for `providerId`, or null when the provider
 * has no usable chat model in the catalog. Ties break on id so the suggestion is
 * stable across renders (an unstable "recommended" chip would look broken).
 */
export function recommendChatModel(
  models: readonly CatalogModel[],
  providerId: string | null | undefined,
): CatalogModel | null {
  if (!providerId) return null
  const candidates = models.filter((m) => m.providerId === providerId && isChatCandidate(m))
  // Tool support is what makes a model usable as an agent; only if the provider
  // offers none at all do we fall back to its plain chat models.
  const pool = candidates.some((m) => m.supportsTools)
    ? candidates.filter((m) => m.supportsTools)
    : candidates
  let best: CatalogModel | null = null
  let bestScore = -Infinity
  for (const model of pool) {
    const value = score(model)
    if (value > bestScore || (value === bestScore && best && model.id < best.id)) {
      best = model
      bestScore = value
    }
  }
  return best
}
