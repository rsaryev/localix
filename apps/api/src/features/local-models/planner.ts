/**
 * How a model runs on THIS computer: whether it fits, at what context, with which cache type, and
 * about how fast — decided before it is downloaded, from its file sizes and its header's shape.
 *
 * Memory: weights + attention cache (per token, by layer: full layers grow with the context,
 * sliding-window layers stop at their window, shared and recurrent layers cost nothing per token)
 * + llama.cpp's compute buffers. The cache is f16 unless only q8_0 lets the context fit: on Metal
 * q8_0 halves the cache but decodes short contexts markedly slower (measured on an M5: 55 vs 85
 * tokens/s for Qwen3 1.7B), and mixed key/value types leave the fast attention path entirely.
 *
 * Speed: decoding streams the active weights and the cache once per token, so tokens/s is about
 * usable bandwidth over those bytes. Rough by design — it ranks and labels, it does not promise.
 */
import type { ModelShape } from './gguf-header'
import type { MachineProfile } from './machine'

export type KvType = 'f16' | 'q8_0'
export type Fit = 'good' | 'tight' | 'too-large'

export interface ModelPlan {
  fit: Fit
  /** Context the server is started with. */
  context: number
  kv: KvType
  /** Memory the model takes at that context. */
  memoryBytes: number
  /** How much more memory it would need, when it does not fit. */
  shortBytes: number
  /** Part of the weights that does not fit on a dedicated GPU and runs from system memory. */
  offloaded: boolean
  tokensPerSecond: number | null
}

export interface PlanInput {
  /** Every file the server loads: weights, projector, draft model. */
  bytes: number
  /** Bytes read per generated token: the active weights (a mixture of experts reads only its own). */
  streamedBytes: number
  shape: ModelShape | null
  contextLength: number | null
  /** Decode speed-up from a draft model (1 without one). */
  speedup?: number
}

/**
 * Contexts tried, best first. 32K at f16 beats 64K at q8_0: 32K holds an agent's instructions,
 * tools and a long exchange, and f16 keeps decoding fast; q8_0 is for when f16 cannot fit.
 */
const ATTEMPTS: ReadonlyArray<readonly [number, KvType]> = [
  [65_536, 'f16'],
  [32_768, 'f16'],
  [65_536, 'q8_0'],
  [32_768, 'q8_0'],
  [16_384, 'f16'],
  [16_384, 'q8_0'],
  [8_192, 'f16'],
  [8_192, 'q8_0'],
]
const MIN_CONTEXT = 8_192
/** Room left for the rest of the computer: a comfortable fit stays under this share. */
const COMFORTABLE_SHARE = 0.6
const KV_ELEMENT_BYTES: Record<KvType, number> = { f16: 2, q8_0: 34 / 32 }
/** llama.cpp's compute buffers: a base plus a share that grows with the context (measured). */
const COMPUTE_BASE_BYTES = 500 * 2 ** 20
const COMPUTE_PER_TOKEN_BYTES = 4_700
/** Without a header: about 110 KB of f16 cache per token per GB of weights (dense 1–8B models). */
const UNKNOWN_KV_PER_TOKEN_PER_GB = 110_000
/** Shares of peak bandwidth decoding reaches, for weights and for the cache (M5 measurements). */
const WEIGHT_BANDWIDTH_SHARE = 0.7
const CACHE_BANDWIDTH_SHARE = 0.6
/** The depth speed is quoted at: a conversation a few turns in. */
const QUOTED_DEPTH = 4_096

/** Cache bytes: per token for growing layers, and a fixed part for sliding-window layers. */
export function cacheBytes(shape: ModelShape | null, kv: KvType, weightBytes: number) {
  const element = KV_ELEMENT_BYTES[kv]
  if (!shape) {
    const perToken = (weightBytes / 1e9) * UNKNOWN_KV_PER_TOKEN_PER_GB * (element / 2)
    return { perToken, fixed: 0 }
  }
  let perToken = 0
  let fixed = 0
  const own = shape.layers - shape.sharedKvLayers
  for (let i = 0; i < own; i++) {
    if (shape.fullAttentionInterval && (i + 1) % shape.fullAttentionInterval !== 0) continue
    const heads = shape.kvHeads[i] ?? 0
    if (heads === 0) continue
    const bytes = heads * (shape.keyLength + shape.valueLength) * element
    if (shape.slidingWindow && shape.slidingLayers?.[i])
      fixed += bytes * (shape.slidingWindow + 512)
    else perToken += bytes
  }
  return { perToken, fixed }
}

export function memoryFor(input: PlanInput, context: number, kv: KvType): number {
  const cache = cacheBytes(input.shape, kv, input.bytes)
  return (
    input.bytes +
    cache.fixed +
    cache.perToken * context +
    COMPUTE_BASE_BYTES +
    COMPUTE_PER_TOKEN_BYTES * context
  )
}

function tokensPerSecond(input: PlanInput, kv: KvType, machine: MachineProfile, gpuShare: number) {
  if (!machine.bandwidth) return null
  const streamed = input.streamedBytes
  const cache = cacheBytes(input.shape, kv, input.bytes)
  const cacheRead = cache.fixed + cache.perToken * QUOTED_DEPTH
  const fast = machine.bandwidth * WEIGHT_BANDWIDTH_SHARE
  const slow = (machine.hostBandwidth ?? machine.bandwidth) * WEIGHT_BANDWIDTH_SHARE
  const seconds =
    (streamed * gpuShare) / fast +
    (streamed * (1 - gpuShare)) / slow +
    cacheRead / (machine.bandwidth * CACHE_BANDWIDTH_SHARE)
  return Math.max(1, Math.round(1 / seconds))
}

const scaled = (tps: number | null, speedup = 1) =>
  tps === null ? null : Math.round(tps * speedup)

/** The largest context (and the cheapest cache type that gets it) within `limit` bytes. */
function largestWithin(input: PlanInput, limit: number) {
  const max = Math.max(MIN_CONTEXT, input.contextLength ?? MIN_CONTEXT)
  for (const [context, kv] of ATTEMPTS) {
    if (context > max) continue
    const memoryBytes = memoryFor(input, context, kv)
    if (memoryBytes <= limit) return { context, kv, memoryBytes }
  }
  return null
}

export function planModel(input: PlanInput, machine: MachineProfile): ModelPlan {
  const budget = machine.modelBytes
  // A dedicated GPU can borrow system memory for the layers it cannot hold (slower).
  const spill = machine.unified ? 0 : machine.hostModelBytes
  const comfortable = largestWithin(input, budget * COMFORTABLE_SHARE)
  const pick = comfortable ?? largestWithin(input, budget) ?? largestWithin(input, budget + spill)
  if (!pick) {
    const memoryBytes = memoryFor(input, MIN_CONTEXT, 'q8_0')
    return {
      fit: 'too-large',
      context: MIN_CONTEXT,
      kv: 'q8_0',
      memoryBytes,
      shortBytes: memoryBytes - (budget + spill),
      offloaded: false,
      tokensPerSecond: null,
    }
  }
  const offloaded = pick.memoryBytes > budget
  const gpuShare = offloaded ? Math.max(0, budget / pick.memoryBytes) : 1
  return {
    fit: comfortable ? 'good' : 'tight',
    context: pick.context,
    kv: pick.kv,
    memoryBytes: pick.memoryBytes,
    shortBytes: 0,
    offloaded,
    tokensPerSecond: scaled(tokensPerSecond(input, pick.kv, machine, gpuShare), input.speedup),
  }
}

/**
 * Share of the weights read per token, from the name's own claim: `35B-A3B` reads 3 of 35
 * billion; Gemma's `E2B` (per-layer embeddings kept out of the hot path) reads about 1.5× its
 * effective size (measured). Dense models read everything.
 */
export function activeFractionOf(repo: string, totalParameters: number | null): number {
  const name = repo.split('/').pop() ?? repo
  const total = totalParameters ?? Number(/(\d+(?:\.\d+)?)B\b/i.exec(name)?.[1] ?? 0) * 1e9
  const active = /-A(\d+(?:\.\d+)?)B\b/i.exec(name)
  if (active && total > 0) return Math.min(1, (Number(active[1]) * 1e9 * 1.1) / total)
  const effective = /-E(\d+(?:\.\d+)?)B\b/i.exec(name)
  if (effective && total > 0) return Math.min(1, (Number(effective[1]) * 1e9 * 1.5) / total)
  return 1
}
