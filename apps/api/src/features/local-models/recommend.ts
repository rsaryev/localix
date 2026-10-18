/**
 * The recommended chat model's choices: every build of the recommended family (Gemma 4) that
 * runs on this computer, each scored on three axes in [0, 1] so Settings can rank them by the
 * person's speed-or-quality preference without asking again:
 *   - intelligence: the size within the family, by the size its name states (Gemma's `E4B`
 *     is 4 billion effective parameters), on a log scale where the largest size is 1;
 *   - speed: expected tokens per second, saturating — past about 40 a person reads no faster;
 *   - fidelity: how much of the original a variant keeps (bits per weight; a 4-bit build of
 *     Gemma's quantization-aware checkpoint counts as near-original, which it was trained for).
 * Memory is a filter, not a score: a build that does not fit is not a choice, and one that
 * fits only with a short context (too short for agent work) is offered only when nothing else
 * fits. Settings weighs the scores (`recommendRanking.ts` in the UI).
 */
import { bitsOf, planFor, type CatalogGroup } from './catalog-rank'
import type { LocalModelEntry, LocalModelSpec, RecommendScores } from './contracts'
import type { ModelShape } from './gguf-header'
import { bitsPerWeight } from './hf-catalog'
import type { MachineProfile } from './machine'
import { originalKey, publisherRank } from './publishers'

/** Tokens per second at which speed scores about 0.8. */
const SPEED_SCALE = 25
/** Agent turns carry tools, files and history: less context than this is a poor default. */
const AGENT_CONTEXT = 16_384
/**
 * The widths offered, one of each: llama.cpp's medium K-quants from 3 to 6 bits and Q8_0, plus
 * Google's quantization-aware Q4_0. Publishers' other mixes are the same trade, finer cut.
 */
const OFFERED_VARIANTS = new Set(['Q3_K_M', 'Q4_K_M', 'Q5_K_M', 'Q6_K', 'Q8_0'])
/** What a quantization-aware 4-bit build keeps, read as bits of a post-training quant. */
const QAT_EQUIVALENT_BITS = 6.5
/** The size a name states: `E4B` (effective), `12B`, `26B-A4B` (total). */
const NAME_SIZE = /-E?(\d+(?:\.\d+)?)B(?:-A\d+B)?-/i

export function speedScore(tokensPerSecond: number | null): number {
  return 1 - Math.exp(-Math.max(0, tokensPerSecond ?? 0) / SPEED_SCALE)
}

export function fidelityScore(variant: string, qat: boolean): number {
  const measured = bitsPerWeight(variant) ?? bitsOf(variant) ?? 4
  // A quantization of a quantization-aware checkpoint at 4 bits or more keeps what it trained for.
  const bits = qat && measured >= 4 ? Math.max(measured, QAT_EQUIVALENT_BITS) : measured
  return Math.max(0, Math.min(1, 1 - 0.01 * Math.max(0, 8.5 - bits) ** 2))
}

export function intelligenceScore(size: number, largest: number): number {
  return Math.min(1, Math.log1p(size) / Math.log1p(largest))
}

const isQat = (spec: LocalModelSpec) =>
  /-qat(-|$)/i.test(spec.repo) || spec.files.some((f) => /qat/i.test(f.name))

/** Billions of parameters the name states, else the counted ones. */
function sizeOf(spec: LocalModelSpec): number | null {
  const named = NAME_SIZE.exec(`${spec.repo.split('/')[1] ?? ''}-`)
  if (named) return Number(named[1])
  return spec.parameters ? spec.parameters / 1e9 : null
}

const offered = (spec: LocalModelSpec) => {
  const variant = spec.variant.toUpperCase()
  return (
    spec.kind === 'chat' &&
    spec.bytes > 0 &&
    (OFFERED_VARIANTS.has(variant) || (variant === 'Q4_0' && isQat(spec)))
  )
}

/** One original model at one width, from the quantization-aware checkpoint or not. */
const keyOf = (spec: LocalModelSpec) =>
  [
    originalKey({ id: spec.repo, cardData: { base_model: spec.baseModel ?? undefined } }),
    spec.variant.toUpperCase(),
    isQat(spec) ? 'qat' : '',
  ].join(':')

/** Every offered build that runs here, one per original model and width (the lab's first), scored. */
export function recommendOptions(input: {
  groups: readonly CatalogGroup[]
  installed: readonly LocalModelSpec[]
  machine: MachineProfile | null
  shapeOf: (spec: LocalModelSpec) => ModelShape | null | undefined
}): LocalModelEntry[] {
  const { machine } = input
  if (!machine) return []
  const specs = input.groups.flatMap((g) => g.specs.filter(offered))
  const largest = Math.max(0, ...specs.map((s) => sizeOf(s) ?? 0))
  if (largest === 0) return []

  const best = new Map<string, LocalModelSpec>()
  for (const spec of specs) {
    const held = best.get(keyOf(spec))
    if (!held || publisherRank(spec.repo) < publisherRank(held.repo)) best.set(keyOf(spec), spec)
  }

  const options = [...best.values()].flatMap((spec): LocalModelEntry[] => {
    const size = sizeOf(spec)
    const plan = planFor(spec, machine, input.shapeOf(spec))
    if (plan.fit === 'too-large' || !size) return []
    const scores: RecommendScores = {
      intelligence: intelligenceScore(size, largest),
      speed: speedScore(plan.tokensPerSecond),
      fidelity: fidelityScore(spec.variant, isQat(spec)),
    }
    return [
      {
        spec,
        installed: input.installed.some((s) => s.id === spec.id),
        featured: true,
        plan,
        downloads: null,
        variants: [],
        exact: spec.files.every((f) => !!f.sha256),
        scores,
      },
    ]
  })
  const roomy = options.filter((e) => (e.plan?.context ?? 0) >= AGENT_CONTEXT)
  return roomy.length > 0 ? roomy : options
}
