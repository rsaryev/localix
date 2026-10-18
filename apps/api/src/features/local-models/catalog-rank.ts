/**
 * The catalog's judgement, pure: each model planned for this computer, at the variant that suits
 * it, then ordered — downloaded models first, then the recommended pick, models that run here
 * before those that do not, and within each, the list's own order.
 */
import type { LocalModelEntry, LocalModelSpec } from './contracts'
import type { ModelShape } from './gguf-header'
import type { MachineProfile } from './machine'
import { activeFractionOf, planModel, type ModelPlan } from './planner'

/** A repository's variants, as the catalog resolved them. */
export interface CatalogGroup {
  repo: string
  specs: LocalModelSpec[]
  downloads: number | null
  /** Exact files from the repository, or estimates from the list. */
  exact?: boolean
}

/** Bits per weight a variant name claims: `Q4_K_M` 4, `IQ3_XXS` 3, `UD-Q5_K_XL` 5, `MXFP4` 4. */
export function bitsOf(variant: string): number | null {
  const v = variant.toUpperCase()
  if (/^(F16|BF16)$/.test(v)) return 16
  if (v === 'F32') return 32
  if (v.endsWith('FP4')) return 4
  const m = /(?:^|[_-])I?Q(\d)/.exec(v) ?? /^I?Q(\d)/.exec(v)
  return m ? Number(m[1]) : null
}

/**
 * How much a pick wants a variant, lower first: 4-bit is the trade most computers want (little
 * quality lost, half the size of 8-bit), then 5–6, then 8; 3-bit only to fit, 1–2-bit last.
 * Within a width, llama.cpp's own K-quant mixes before the rest.
 */
function preference(variant: string): number {
  const bits = bitsOf(variant)
  const width =
    bits === null
      ? 9
      : bits === 4
        ? 0
        : bits === 5
          ? 1
          : bits === 6
            ? 2
            : bits === 8
              ? 3
              : bits === 3
                ? 4
                : bits < 3
                  ? 6
                  : 8
  return width * 10 + (/K_M$/i.test(variant) ? 0 : variant.toUpperCase().endsWith('_0') ? 1 : 2)
}
/** Below this, quality drops fast: such a variant is offered only when nothing else fits. */
const MIN_USEFUL_BITS = 3
/** A small model fast enough at Q8_0 is worth its better answers. */
const Q8_FAST_ENOUGH_TPS = 40
/** Share of a mixture-of-experts model outside its experts (attention, embeddings, router). */
const MOE_SHARED_SHARE = 0.1
/** Speculative decoding's gain, conservatively (1.7–2.2× measured on Gemma 4 E2B). */
const DRAFT_SPEEDUP = 1.5
export function planFor(
  spec: LocalModelSpec,
  machine: MachineProfile,
  shape: ModelShape | null | undefined,
): ModelPlan {
  const weights = spec.files.filter((f) => f.role === 'weights').reduce((n, f) => n + f.bytes, 0)
  // A mixture of experts reads its shared layers and only the experts a token is routed to.
  const routed =
    shape?.experts && shape.expertsUsed
      ? MOE_SHARED_SHARE + (1 - MOE_SHARED_SHARE) * (shape.expertsUsed / shape.experts)
      : 1
  return planModel(
    {
      bytes: spec.bytes,
      streamedBytes:
        weights * Math.min(routed, activeFractionOf(spec.repo, spec.parameters ?? null)),
      shape: shape ?? null,
      contextLength: shape?.contextLength ?? spec.contextLength,
      speedup: spec.draft ? DRAFT_SPEEDUP : 1,
    },
    machine,
  )
}

/** The variant to offer: the preferred one that runs comfortably, else the one that runs at all. */
export function pickVariant(
  specs: readonly LocalModelSpec[],
  planOf: (spec: LocalModelSpec) => ModelPlan | null,
): LocalModelSpec | undefined {
  const quantized = specs.filter((s) => (bitsOf(s.variant) ?? 0) < 16)
  const pool = [...(quantized.length ? quantized : specs)].sort(
    (a, b) => preference(a.variant) - preference(b.variant) || a.bytes - b.bytes,
  )
  const fit = (s: LocalModelSpec) => planOf(s)?.fit ?? 'good'
  const q8 = pool.find((s) => s.variant.toUpperCase() === 'Q8_0')
  const q8Plan = q8 && planOf(q8)
  if (q8Plan?.fit === 'good' && (q8Plan.tokensPerSecond ?? 0) >= Q8_FAST_ENOUGH_TPS) return q8
  const useful = (s: LocalModelSpec) => (bitsOf(s.variant) ?? 4) >= MIN_USEFUL_BITS
  return (
    pool.find((s) => useful(s) && fit(s) === 'good') ??
    pool.find((s) => useful(s) && fit(s) === 'tight') ??
    pool.find((s) => fit(s) !== 'too-large') ??
    [...pool].sort((a, b) => a.bytes - b.bytes)[0]
  )
}

export function buildEntries(input: {
  groups: readonly CatalogGroup[]
  installed: readonly LocalModelSpec[]
  machine: MachineProfile | null
  shapeOf: (spec: LocalModelSpec) => ModelShape | null | undefined
}): LocalModelEntry[] {
  const { machine } = input
  // An unsized build (its width unknown until its files are read) has no plan yet.
  const planOf = (spec: LocalModelSpec) =>
    machine && spec.bytes > 0 ? planFor(spec, machine, input.shapeOf(spec)) : null
  const entries: LocalModelEntry[] = []
  for (const group of input.groups) {
    const installedHere = input.installed.find((s) => s.repo === group.repo)
    const latestHere = installedHere && group.specs.find((s) => s.id === installedHere.id)
    // A manifest from before the catalog learned a fact (thinking) takes it from the catalog.
    const here = installedHere && {
      ...installedHere,
      reasoning: installedHere.reasoning ?? latestHere?.reasoning,
    }
    const spec = here ?? pickVariant(group.specs, planOf)
    if (!spec) continue
    const latest = here && group.specs.find((s) => s.id === here.id)
    const have = new Set(here?.files.map((f) => f.name))
    const added = latest ? latest.files.filter((f) => !have.has(f.name)) : []
    entries.push({
      ...(added.length ? { upgradeBytes: added.reduce((n, f) => n + f.bytes, 0) } : {}),
      spec,
      installed: !!here,
      featured: false,
      plan: planOf(spec),
      downloads: group.downloads,
      exact: here ? true : (group.exact ?? true),
      variants: [...group.specs]
        .sort((a, b) => a.bytes - b.bytes)
        .map((s) => ({
          id: s.id,
          variant: s.variant,
          bytes: s.bytes,
          fit: planOf(s)?.fit ?? 'good',
        })),
    })
  }
  return entries
}

const runsHere = (e: LocalModelEntry) => (e.plan?.fit ?? 'good') !== 'too-large'

/**
 * The catalog's order: downloaded models first, then the recommended pick, then the models
 * that run here before those that do not — and within each, the list's own order, or with
 * `newest`, the newest first.
 */
export function sortEntries(
  entries: readonly LocalModelEntry[],
  options: { newest?: boolean } = {},
): LocalModelEntry[] {
  const released = (e: LocalModelEntry) => Date.parse(e.spec.releasedAt ?? '') || 0
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        Number(b.entry.installed) - Number(a.entry.installed) ||
        Number(b.entry.featured) - Number(a.entry.featured) ||
        Number(runsHere(b.entry)) - Number(runsHere(a.entry)) ||
        (options.newest ? released(b.entry) - released(a.entry) : 0) ||
        a.index - b.index,
    )
    .map(({ entry }) => entry)
}
