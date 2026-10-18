/**
 * Vector arithmetic for the semantic index: Matryoshka truncation, the float16 storage codec,
 * and the per-query standardization every search runs on.
 *
 * Vectors are stored L2-normalized, so cosine similarity is a dot product. On disk each one is
 * float16 (half the bytes, no measurable ranking change at these widths); in memory they are
 * float32 rows of one contiguous matrix, which is what makes a brute-force scan of tens of
 * thousands of chunks a few milliseconds.
 */

/** Keep the first `dimensions` components and re-normalize (Matryoshka models allow this). */
export function truncateNormalize(vector: ArrayLike<number>, dimensions: number): Float32Array {
  const width = Math.min(dimensions, vector.length)
  const out = new Float32Array(width)
  let squares = 0
  for (let i = 0; i < width; i++) {
    const v = vector[i]!
    out[i] = v
    squares += v * v
  }
  const norm = Math.sqrt(squares)
  if (norm > 0 && Number.isFinite(norm)) for (let i = 0; i < width; i++) out[i] = out[i]! / norm
  return out
}

/** True when every component is finite — a NaN vector must never reach the index. */
export function isFiniteVector(vector: ArrayLike<number>): boolean {
  for (let i = 0; i < vector.length; i++) if (!Number.isFinite(vector[i]!)) return false
  return vector.length > 0
}

const f32 = new Float32Array(1)
const u32 = new Uint32Array(f32.buffer)

/** IEEE 754 binary32 → binary16 bits, round-to-nearest-even, with subnormals and infinities. */
export function toHalfBits(value: number): number {
  f32[0] = value
  const x = u32[0]!
  const sign = (x >>> 16) & 0x8000
  const exponent = (x >>> 23) & 0xff
  let mantissa = x & 0x7fffff
  if (exponent === 0xff) return sign | 0x7c00 | (mantissa ? 0x200 : 0)
  const e = exponent - 127 + 15
  if (e >= 0x1f) return sign | 0x7c00
  if (e <= 0) {
    if (e < -10) return sign
    mantissa |= 0x800000
    const shift = 14 - e
    let half = mantissa >>> shift
    const rest = mantissa & ((1 << shift) - 1)
    const halfway = 1 << (shift - 1)
    if (rest > halfway || (rest === halfway && half & 1)) half += 1
    return sign | half
  }
  let half = sign | (e << 10) | (mantissa >>> 13)
  const rest = mantissa & 0x1fff
  if (rest > 0x1000 || (rest === 0x1000 && half & 1)) half += 1
  return half
}

export function fromHalfBits(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1
  const exponent = (bits >>> 10) & 0x1f
  const mantissa = bits & 0x3ff
  if (exponent === 0) return sign * mantissa * 2 ** -24
  if (exponent === 0x1f) return mantissa ? Number.NaN : sign * Number.POSITIVE_INFINITY
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15)
}

/** float16 little-endian bytes: half the size of float32, no measurable ranking change. */
export function encodeVector(vector: Float32Array): Uint8Array {
  const out = new Uint8Array(vector.length * 2)
  for (let i = 0; i < vector.length; i++) {
    const bits = toHalfBits(vector[i]!)
    out[i * 2] = bits & 0xff
    out[i * 2 + 1] = bits >>> 8
  }
  return out
}

export function decodeVector(blob: Uint8Array, dimensions: number): Float32Array {
  if (blob.byteLength !== dimensions * 2) {
    throw new Error(`vector blob is ${blob.byteLength} bytes, expected ${dimensions * 2}`)
  }
  const out = new Float32Array(dimensions)
  for (let i = 0; i < dimensions; i++) out[i] = fromHalfBits(blob[i * 2]! | (blob[i * 2 + 1]! << 8))
  return out
}

/** `scores[i] = rows[i] · query` for a row-major matrix of `count` rows. */
export function scoreRows(
  matrix: Float32Array,
  count: number,
  dimensions: number,
  query: Float32Array,
): Float32Array {
  const scores = new Float32Array(count)
  for (let row = 0; row < count; row++) {
    const base = row * dimensions
    let sum = 0
    for (let i = 0; i < dimensions; i++) sum += matrix[base + i]! * query[i]!
    scores[row] = sum
  }
  return scores
}

/**
 * The z a match must reach in a population of `n`: about where the best of `n` unrelated items
 * lands (√(2·ln n), the expected maximum of n standard normals), less half a deviation, kept
 * between 2 and 3. Measured on a real history of 134 messages: the top unrelated message sat
 * at z 2.3–2.5 for every off-topic query, while a fixed gate of 2 let it through each time.
 */
export function standoutGate(n: number): number {
  if (n < 2) return 2
  return Math.min(3, Math.max(2, Math.sqrt(2 * Math.log(n)) - 0.5))
}

/**
 * Hubness correction (CSLS-style): a vector near the collection's centroid — short, generic
 * text like "ok, run it again" — is close to EVERY query. Subtracting how far an item's own
 * centroid similarity sits above the average turns "similar to everything" into "similar to
 * nothing in particular". Measured on the same history: an off-topic query's top match fell
 * from z 2.28 to 1.6, while the real matches kept their lead.
 */
export function correctHubness(cosines: Float32Array, hubs: Float32Array): void {
  let mean = 0
  for (let i = 0; i < hubs.length; i++) mean += hubs[i]!
  mean /= Math.max(hubs.length, 1)
  // A penalty only: lifting items far from the centroid would make every unusual item a match
  // for every query in a collection of near-duplicates.
  for (let i = 0; i < cosines.length; i++) cosines[i] = cosines[i]! - Math.max(0, hubs[i]! - mean)
}

/** Each row's similarity to the matrix centroid. */
export function centroidSimilarities(matrix: Float32Array, count: number, dimensions: number) {
  const centroid = new Float32Array(dimensions)
  for (let row = 0; row < count; row++) {
    for (let i = 0; i < dimensions; i++)
      centroid[i] = centroid[i]! + matrix[row * dimensions + i]! / count
  }
  return scoreRows(matrix, count, dimensions, centroid)
}

/** Below this many vectors the distribution says too little to standardize against. */
export const MIN_POPULATION = 24
/**
 * A floor on the deviation, so a collection that is uniformly unrelated to a query cannot turn
 * a hair of difference into a standout. 0.03 is under the spread measured for unrelated pairs
 * on EmbeddingGemma 2 at 256 dimensions (~0.035–0.04): z ≥ 2 then needs a cosine margin of 0.06.
 */
const MIN_DEVIATION = 0.03

/**
 * This query's scores in standard deviations from their mean. Every vector is scored anyway,
 * so the scale is free; a match "stands out" when its z clears the gate. A tiny collection
 * (under {@link MIN_POPULATION}) cannot define a distribution, so its z is derived from a
 * fixed scale around a typical unrelated cosine instead — conservative, never inflated.
 */
export function standardize(scores: Float32Array): Float64Array {
  const n = scores.length
  const z = new Float64Array(n)
  if (n === 0) return z
  if (n < MIN_POPULATION) {
    for (let i = 0; i < n; i++) z[i] = (scores[i]! - SMALL_POPULATION_MEAN) / SMALL_POPULATION_DEV
    return z
  }
  let sum = 0
  for (let i = 0; i < n; i++) sum += scores[i]!
  const mean = sum / n
  let squares = 0
  for (let i = 0; i < n; i++) squares += (scores[i]! - mean) ** 2
  const deviation = Math.max(Math.sqrt(squares / n), MIN_DEVIATION)
  for (let i = 0; i < n; i++) z[i] = (scores[i]! - mean) / deviation
  return z
}

/**
 * The fixed scale for small collections, measured on EmbeddingGemma 2 at 256 dimensions:
 * unrelated query/document pairs sit near 0.64 with a spread of about 0.04, and a relevant
 * one at 0.76+ (z ≈ 3).
 */
const SMALL_POPULATION_MEAN = 0.64
const SMALL_POPULATION_DEV = 0.04
