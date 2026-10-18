/**
 * Hugging Face repositories as local-model specs — pure parsing, nothing fetched here.
 *
 * A GGUF repository holds several VARIANTS of one model (quantizations such as Q4_0 or Q8_0, each
 * one file or several shards) and, for vision models, a projector (`mmproj`). Speculative heads
 * shipped beside the model (EAGLE-3, MTP) are not variants and are left out.
 *
 * Two readings of the same repository:
 *   - `estimatedSpecs` from a LIST row (names, parameters, no sizes): what a catalog card shows —
 *     each variant's size worked out from its parameter count and the quant's bits per weight;
 *   - `specsFromRepo` from a repository read WITH sizes and LFS hashes: the exact, pinned files a
 *     download verifies. Only these are ever installed.
 */
import type { LocalModelFile, LocalModelKind, LocalModelSpec } from './contracts'
import { HF_BASE, type HfModel, type HfRepoInfo } from './hf-client'

const EMBEDDING_TAGS = new Set(['feature-extraction', 'sentence-similarity'])
/** Tags of models that are neither chat nor embedding (rerankers, speech…). */
const UNSUPPORTED_TAGS = new Set(['text-ranking', 'automatic-speech-recognition', 'text-to-speech'])
/** An embedding repository that carries no pipeline tag still says so in its name. */
const EMBEDDING_NAME = /embed/i

export function kindOf(pipelineTag: string | null | undefined, repo = ''): LocalModelKind | null {
  if (pipelineTag && UNSUPPORTED_TAGS.has(pipelineTag)) return null
  if (pipelineTag && EMBEDDING_TAGS.has(pipelineTag)) return 'embedding'
  return !pipelineTag && EMBEDDING_NAME.test(repo.split('/').pop() ?? '') ? 'embedding' : 'chat'
}

/** A vision projector, wherever the name puts the word (`mmproj-x.gguf`, `x-mmproj-f16.gguf`). */
const PROJECTOR = /mmproj[^/]*\.gguf$/i
/** Speculative-decoding heads shipped beside a model (EAGLE-3, MTP, DFlash): not variants of it. */
const DRAFT_HEAD = /^(eagle3?|mtp|dflash|dspark|draft)[-_]/i
const SHARD = /-(\d{5})-of-(\d{5})\.gguf$/
/**
 * The quantization a file name carries, wherever the publisher put it: `x-Q4_K_M.gguf`,
 * `x-UD-Q4_K_XL.gguf`, Google's `gemma-4-E4B_q4_0-it.gguf`. The last such token wins.
 */
const QUANT_TOKEN =
  /(?:^|[-_.])((?:UD-)?(?:I?Q\d(?:_[A-Z0-9]+)*|MXFP4|NVFP4|BF16|F16|F32))(?=$|[-.])/gi

/** The variant name of a repository's one build whose file names no quant. */
export const SINGLE_BUILD = 'GGUF'

export function variantOfFile(name: string): string | null {
  const base = name.replace(SHARD, '').replace(/\.gguf$/i, '')
  const tokens = [...base.matchAll(QUANT_TOKEN)]
  return tokens.at(-1)?.[1] ?? null
}
/** A chat template that switches thinking on and off, or takes a reasoning effort. */
const THINKING_TEMPLATE = /enable_thinking|reasoning_effort|<think>|<\|think\|>/

/**
 * Bits per weight of llama.cpp's quant types, block scales included (`llama-quantize` tables).
 * A publisher's own mix (`UD-Q4_K_XL`) reads as its base type, a little larger.
 */
const BITS_PER_WEIGHT: Record<string, number> = {
  F32: 32,
  F16: 16,
  BF16: 16,
  Q8_0: 8.5,
  Q6_K: 6.56,
  Q5_K_M: 5.69,
  Q5_K_S: 5.54,
  Q5_0: 5.5,
  Q4_K_M: 4.85,
  Q4_K_S: 4.58,
  Q4_0: 4.5,
  IQ4_NL: 4.5,
  IQ4_XS: 4.25,
  MXFP4: 4.25,
  NVFP4: 4.5,
  Q3_K_L: 4.27,
  Q3_K_M: 3.91,
  Q3_K_S: 3.5,
  IQ3_M: 3.66,
  IQ3_XS: 3.3,
  IQ3_XXS: 3.06,
  Q2_K: 2.96,
  IQ2_M: 2.7,
  IQ2_XS: 2.31,
  IQ2_XXS: 2.06,
  IQ1_M: 1.75,
  IQ1_S: 1.56,
}
/** A projector is small beside the weights; its size is known once the repository is read. */
const PROJECTOR_ESTIMATE_BYTES = 0.6e9

export function bitsPerWeight(variant: string): number | null {
  const v = variant.toUpperCase().replace(/^UD[-_]/, '')
  if (BITS_PER_WEIGHT[v]) return BITS_PER_WEIGHT[v]!
  // A publisher's larger mix of a K-quant (`Q4_K_XL`) is its medium type with more kept wide.
  const mixed = v.replace(/_K_X*L$/, '_K_M')
  if (mixed !== v && BITS_PER_WEIGHT[mixed]) return BITS_PER_WEIGHT[mixed]! + 0.2
  const base = Object.keys(BITS_PER_WEIGHT).find((type) => v.startsWith(type))
  if (base) return BITS_PER_WEIGHT[base]! + 0.2
  const bits = /I?Q(\d)/.exec(v)
  return bits ? Number(bits[1]) + 0.5 : null
}

/**
 * A model's parameter count. Hugging Face reads it from one GGUF file, and for a split or
 * multi-file repository that file can be a small one (a projector), so a count far below the
 * size the name states (`120B`; an active `A12B` is not the total) yields to the name.
 */
export function parametersOf(model: Pick<HfModel, 'id' | 'gguf'>): number | null {
  const named = [
    ...(model.id.split('/').pop() ?? '').matchAll(/(?:^|[-_])(\d+(?:\.\d+)?)B(?=[-_]|$)/gi),
  ]
    .map((m) => Number(m[1]) * 1e9)
    .reduce((max, n) => Math.max(max, n), 0)
  const reported = model.gguf?.total ?? 0
  if (named > 0 && reported < named * 0.5) return named
  return reported || null
}

export function fileUrl(repo: string, revision: string, name: string): string {
  return `${HF_BASE}/${repo}/resolve/${revision}/${name.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * "gemma-4-E2B-it-GGUF" → "Gemma 4 E2B it": the model's name, readable, without the packaging —
 * the GGUF suffix and a quant some publishers put in the repository name.
 */
/** Name parts that say how a build was made, not which model it is (its facts line says it). */
const BUILD_TOKEN = /^(gguf|it|qat|f16|bf16|mxfp4)$/i

export function labelOf(repo: string): string {
  const base = repo
    .split('/')
    .pop()!
    // A converter's `Lab_Model` names the lab first (`google_gemma-4-E4B-it`).
    .replace(/^[A-Za-z-]+_(?=[A-Za-z])/, '')
    // A quantization is one token though it holds underscores: `q4_0`, `Q4_K_M`.
    .replace(/(^|[-_])(?:UD-)?I?Q\d(?:_[A-Z0-9]+)*(?=[-_]|$)/gi, '')
    // A mixture of experts' size stays one token: `26B-A4B`.
    .replace(/(\d+B)[-_](A\d+B)/gi, '$1~$2')
    .split(/[-_]+/)
    .filter((part) => part && !BUILD_TOKEN.test(part))
    .join(' ')
    .replaceAll('~', '-')
  return `${base.charAt(0).toUpperCase()}${base.slice(1)}`
}

/** The original model a conversion names in its card, when it names one other than itself. */
export function originalOf(model: Pick<HfModel, 'id' | 'cardData'>): string | null {
  const base = model.cardData?.base_model
  const original = Array.isArray(base) ? base[0] : base
  return original && original !== model.id ? original : null
}

type Sibling = NonNullable<HfModel['siblings']>[number]

/** A repository's complete variants (every shard present) and its projector, by file name. */
function variantsOf(siblings: readonly Sibling[]) {
  const ggufs = siblings.filter((f) => f.rfilename.endsWith('.gguf'))
  const projectors = ggufs.filter((f) => PROJECTOR.test(f.rfilename))
  // A projector at Q8_0, else the smallest offered.
  const projector =
    projectors.find((f) => /Q8_0\.gguf$/i.test(f.rfilename)) ??
    [...projectors].sort((a, b) => (a.size ?? 0) - (b.size ?? 0))[0]
  const byVariant = new Map<string, Sibling[]>()
  for (const f of ggufs) {
    const name = f.rfilename.split('/').pop()!
    if (PROJECTOR.test(name) || DRAFT_HEAD.test(name)) continue
    const variant = variantOfFile(name)
    if (!variant) continue
    byVariant.set(variant, [...(byVariant.get(variant) ?? []), f])
  }
  // One weights file whose name carries no quant (`Model-24GB.gguf`): the repository's only build.
  const unnamed = ggufs.filter((f) => {
    const name = f.rfilename.split('/').pop()!
    return !PROJECTOR.test(name) && !DRAFT_HEAD.test(name) && !variantOfFile(name)
  })
  if (byVariant.size === 0 && unnamed.length === 1) byVariant.set(SINGLE_BUILD, unnamed)
  const variants: Array<{ variant: string; weights: Sibling[] }> = []
  for (const [variant, group] of byVariant) {
    // A split model is complete only with every shard; llama.cpp opens the first and finds the rest.
    const shards = group.filter((f) => SHARD.test(f.rfilename))
    if (shards.length > 0 && shards.length !== Number(SHARD.exec(shards[0]!.rfilename)![2]))
      continue
    const weights = (shards.length > 0 ? shards : group.slice(0, 1)).sort((a, b) =>
      a.rfilename.localeCompare(b.rfilename),
    )
    variants.push({ variant, weights })
  }
  return { variants, projector }
}

/** What every spec of a repository shares. */
function common(model: HfModel, kind: LocalModelKind) {
  return {
    repo: model.id,
    kind,
    label: labelOf(model.id),
    license: model.cardData?.license ?? null,
    architecture: model.gguf?.architecture ?? null,
    contextLength: model.gguf?.context_length ?? null,
    releasedAt: model.createdAt ?? null,
    parameters: parametersOf(model),
    reasoning: THINKING_TEMPLATE.test(model.gguf?.chat_template ?? ''),
    baseModel: originalOf(model),
  }
}

/** The exact specs of a repository read with sizes and hashes — what a download verifies. */
export function specsFromRepo(info: HfRepoInfo): LocalModelSpec[] {
  const kind = kindOf(info.pipeline_tag, info.id)
  if (!kind) return []
  const verifiable = (info.siblings ?? []).filter((f) => f.size && f.lfs?.sha256)
  const { variants, projector } = variantsOf(verifiable)
  const toFile = (f: Sibling, role: LocalModelFile['role']): LocalModelFile => ({
    name: f.rfilename,
    url: fileUrl(info.id, info.sha, f.rfilename),
    bytes: f.size!,
    sha256: f.lfs!.sha256!,
    role,
  })
  const withProjector = kind === 'chat' ? projector : undefined
  return variants
    .map(({ variant, weights }) => {
      const files = [
        ...weights.map((f) => toFile(f, 'weights')),
        ...(withProjector ? [toFile(withProjector, 'projector')] : []),
      ]
      return {
        id: `${info.id}:${variant}`,
        revision: info.sha,
        variant,
        vision: !!withProjector,
        files,
        bytes: files.reduce((n, f) => n + f.bytes, 0),
        ...common(info, kind),
      }
    })
    .sort((a, b) => a.bytes - b.bytes)
}

/**
 * Specs from a list row: the variants its file names show, each sized from the parameter count
 * and the quant's bits per weight (within a few percent of the file). Files carry no hash — an
 * estimate is for showing and planning, never for downloading. Empty without a parameter count.
 */
export function estimatedSpecs(model: HfModel): LocalModelSpec[] {
  const kind = kindOf(model.pipeline_tag, model.id)
  const parameters = parametersOf(model)
  if (!kind || !parameters || !model.sha) return []
  const { variants, projector } = variantsOf(model.siblings ?? [])
  const withProjector = kind === 'chat' ? projector : undefined
  const specs: LocalModelSpec[] = []
  for (const { variant, weights } of variants) {
    const bits = bitsPerWeight(variant)
    // A build of unknown width is listed unsized (0): its size is read with its files.
    if (!bits && variant !== SINGLE_BUILD) continue
    const weightBytes = bits ? Math.round((parameters * bits) / 8) : 0
    const files: LocalModelFile[] = weights.map((f, i) => ({
      name: f.rfilename,
      url: fileUrl(model.id, model.sha!, f.rfilename),
      bytes: i === 0 ? weightBytes : 0,
      sha256: '',
      role: 'weights',
    }))
    if (withProjector && weightBytes > 0) {
      files.push({
        name: withProjector.rfilename,
        url: fileUrl(model.id, model.sha, withProjector.rfilename),
        bytes: PROJECTOR_ESTIMATE_BYTES,
        sha256: '',
        role: 'projector',
      })
    }
    specs.push({
      id: `${model.id}:${variant}`,
      revision: model.sha,
      variant,
      vision: !!withProjector,
      files,
      bytes: files.reduce((n, f) => n + f.bytes, 0),
      ...common(model, kind),
    })
  }
  return specs.sort((a, b) => a.bytes - b.bytes)
}
