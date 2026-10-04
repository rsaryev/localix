/**
 * Per-model calibration of the byte heuristic against what the provider actually billed.
 *
 * A request is sized with a chars/4 (or bytes/4) heuristic plus a flat allowance per image,
 * corrected by the provider's last measurement. The heuristic is deliberately conservative, and
 * on real sessions that conservatism is not small: one measured the JSON-bytes heuristic at 2.2×
 * the provider's count for a code-heavy gpt session. The measurement covers the prefix; everything appended
 * inside a run is heuristic again, and a run that appends screenshots and large tool results
 * can be pushed over its budget by a divisor that is wrong for THIS model.
 *
 * The image cost is learned from usage: the residual between `prompt_tokens` and the text
 * projection, divided by the image count. This module learns both terms: a text SCALE
 * (measured ÷ heuristic) and an image cost, updated by an exponential moving average from each
 * request whose input the provider measured. Text-only
 * requests teach the scale; requests with images teach the image cost at the current scale.
 *
 * Bounded on both sides so a single odd usage row (a cache-miss retry, a provider that reports
 * differently) cannot swing the estimate into an under-count: an over-estimate compacts early,
 * an under-estimate overflows at the provider.
 */

export interface TokenCalibration {
  /** Multiplier for the text heuristic: `measured ÷ heuristic`, 1 = uncalibrated. */
  textScale: number
  /** Tokens per inline image part, replacing the flat default once learned. */
  imageTokens: number
  /** Text-only measured requests folded into `textScale` so far. */
  samples: number
  /** Measured requests with images folded into `imageTokens` so far. */
  imageSamples: number
}

/** The size of a wire in the two currencies the calibration separates. */
export interface WireSizeSample {
  /** Byte-heuristic tokens of everything that is text or JSON (images already excluded). */
  textTokens: number
  images: number
}

export const DEFAULT_IMAGE_TOKENS = 1600

export const DEFAULT_TOKEN_CALIBRATION: TokenCalibration = {
  textScale: 1,
  imageTokens: DEFAULT_IMAGE_TOKENS,
  samples: 0,
  imageSamples: 0,
}

/**
 * Plausibility bounds. A sample outside them teaches NOTHING: an implausible residual is
 * rejected rather than clamped, because a clamped nonsense value would still bias the
 * average. The text floor sits just under the worst measured ratio (0.466 for
 * code-heavy gpt) so a real model can be fitted while a pathological usage row cannot halve
 * the estimate.
 */
export const TEXT_SCALE_BOUNDS = { min: 0.4, max: 1.25 } as const
export const IMAGE_TOKENS_BOUNDS = { min: 64, max: 6000 } as const
/**
 * Requests with less CONTENT than this teach nothing: their ratio is the fixed floor's error
 * (system prompt + schemas; replayed 19.1k estimated vs 23.9k measured on a first
 * turn), not the content's, and the floor is charged separately.
 */
export const MIN_CALIBRATION_TEXT_TOKENS = 4_000
/**
 * Below this share of the measured request, the images are a correction term and the sample
 * teaches the TEXT scale with the images charged at the current allowance; above it the sample
 * teaches the image cost instead. A screenshot-heavy coding session (3–7 images
 * beside 20–70k of text) would otherwise never fix the text scale, which is its dominant error.
 */
export const IMAGE_SHARE_FOR_IMAGE_LEARNING = 0.25
/** EMA weight of the newest sample: recent requests describe the model best, but not alone. */
const EMA_ALPHA = 0.35

const plausible = (value: number, bounds: { min: number; max: number }): boolean =>
  Number.isFinite(value) && value >= bounds.min && value <= bounds.max

const ema = (previous: number, sample: number, samples: number): number =>
  samples === 0 ? sample : previous + EMA_ALPHA * (sample - previous)

/**
 * Fold one measured request into the calibration. `measuredInputTokens` is the provider's
 * input count for the request whose wire `sample` describes; `fixedOverheadTokens` is the
 * heuristic size of the system prompt and tool schemas, which the provider counted too.
 * Returns the previous calibration unchanged when the sample cannot teach anything:
 *   - no usage, or a request that is mostly the fixed floor;
 *   - a text ratio or per-image cost outside plausibility;
 *   - an image-dominant request before any text sample has fixed the text scale — the
 *     residual would attribute the whole text error to the images (replayed on a real session:
 *     7 screenshots "cost" 64 tokens each because the text was still counted at 2×).
 */
export function observeTokenCalibration(
  previous: TokenCalibration,
  sample: WireSizeSample,
  measuredInputTokens: number,
  fixedOverheadTokens = 0,
): TokenCalibration {
  if (!Number.isFinite(measuredInputTokens) || measuredInputTokens <= 0) return previous
  if (sample.textTokens < MIN_CALIBRATION_TEXT_TOKENS) return previous
  const heuristicText = sample.textTokens + Math.max(0, fixedOverheadTokens)
  const imageAllowance = sample.images * previous.imageTokens
  if (imageAllowance <= measuredInputTokens * IMAGE_SHARE_FOR_IMAGE_LEARNING) {
    // Text-dominant: the images are charged at their current allowance, the rest is text.
    const scale = (measuredInputTokens - imageAllowance) / heuristicText
    if (!plausible(scale, TEXT_SCALE_BOUNDS)) return previous
    return {
      ...previous,
      textScale: ema(previous.textScale, scale, previous.samples),
      samples: previous.samples + 1,
    }
  }
  if (previous.samples === 0) return previous
  // Image-dominant, text already calibrated: what the text does not account for is the images'.
  const residual = measuredInputTokens - heuristicText * previous.textScale
  const perImage = residual / sample.images
  if (!plausible(perImage, IMAGE_TOKENS_BOUNDS)) return previous
  return {
    ...previous,
    imageTokens: ema(previous.imageTokens, perImage, previous.imageSamples),
    imageSamples: previous.imageSamples + 1,
  }
}

/** The calibrated token cost of one wire message size. */
export function calibratedTokens(size: WireSizeSample, calibration: TokenCalibration): number {
  return Math.ceil(size.textTokens * calibration.textScale + size.images * calibration.imageTokens)
}
