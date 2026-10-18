/**
 * A GGUF file's metadata, read from its first bytes — what a model needs in memory can be known
 * before it is downloaded.
 *
 * The header is `GGUF`, a version, the tensor and key counts, then typed key/value pairs. Only the
 * keys that size the attention cache are kept ({@link ModelShape}); the reader stops at the first
 * `tokenizer.*` key once those are in hand, so the vocabulary (megabytes of strings) is never read.
 * Reading needs more bytes than were fetched → {@link NeedMoreBytes}, and the caller fetches more.
 */

/** What the planner needs to size a model's attention cache and its decode speed. */
export interface ModelShape {
  architecture: string
  layers: number
  contextLength: number | null
  /** Key/value heads per layer; 0 marks a layer with no attention cache (recurrent, linear). */
  kvHeads: number[]
  keyLength: number
  valueLength: number
  /** Window of the sliding-window layers, and which layers slide (null: none do). */
  slidingWindow: number | null
  slidingLayers: boolean[] | null
  /** Trailing layers that reuse an earlier layer's cache (Gemma 3n/4 E-models). */
  sharedKvLayers: number
  /** One in this many layers has full attention; the others are linear (Qwen3-Next style). */
  fullAttentionInterval: number | null
  experts: number | null
  expertsUsed: number | null
}

export class NeedMoreBytes extends Error {
  readonly needed: number
  constructor(needed: number) {
    super(`GGUF header continues past ${needed} bytes`)
    this.needed = needed
  }
}

type Value = number | bigint | string | boolean | Value[]

const SCALAR_BYTES: Record<number, number> = {
  0: 1,
  1: 1,
  2: 2,
  3: 2,
  4: 4,
  5: 4,
  6: 4,
  7: 1,
  10: 8,
  11: 8,
  12: 8,
}
const STRING = 8
const ARRAY = 9
const decoder = new TextDecoder()

class Reader {
  offset = 0
  private readonly view: DataView
  private readonly bytes: Uint8Array
  constructor(bytes: Uint8Array) {
    this.bytes = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
  private need(n: number) {
    if (this.offset + n > this.bytes.byteLength) throw new NeedMoreBytes(this.offset + n)
  }
  u32() {
    this.need(4)
    const v = this.view.getUint32(this.offset, true)
    this.offset += 4
    return v
  }
  u64() {
    this.need(8)
    const v = this.view.getBigUint64(this.offset, true)
    this.offset += 8
    return Number(v)
  }
  string() {
    const length = this.u64()
    this.need(length)
    const s = decoder.decode(this.bytes.subarray(this.offset, this.offset + length))
    this.offset += length
    return s
  }
  scalar(type: number): Value {
    const size = SCALAR_BYTES[type]
    if (size === undefined) throw new Error(`Unknown GGUF value type ${type}`)
    this.need(size)
    const at = this.offset
    this.offset += size
    const v = this.view
    switch (type) {
      case 0:
        return v.getUint8(at)
      case 1:
        return v.getInt8(at)
      case 2:
        return v.getUint16(at, true)
      case 3:
        return v.getInt16(at, true)
      case 4:
        return v.getUint32(at, true)
      case 5:
        return v.getInt32(at, true)
      case 6:
        return v.getFloat32(at, true)
      case 7:
        return v.getUint8(at) !== 0
      case 10:
        return Number(v.getBigUint64(at, true))
      case 11:
        return Number(v.getBigInt64(at, true))
      default:
        return v.getFloat64(at, true)
    }
  }
  value(type: number): Value {
    if (type === STRING) return this.string()
    if (type !== ARRAY) return this.scalar(type)
    const itemType = this.u32()
    const count = this.u64()
    const items: Value[] = []
    for (let i = 0; i < count; i++) items.push(this.value(itemType))
    return items
  }
}

/** The metadata keys of a GGUF header, up to the vocabulary. */
export function readGgufMetadata(bytes: Uint8Array): Map<string, Value> {
  const r = new Reader(bytes)
  if (r.u32() !== 0x46554747) throw new Error('Not a GGUF file')
  const version = r.u32()
  if (version < 2) throw new Error(`GGUF version ${version} is not supported`)
  r.u64() // tensor count
  const count = r.u64()
  const keys = new Map<string, Value>()
  for (let i = 0; i < count; i++) {
    const key = r.string()
    const type = r.u32()
    const arch = keys.get('general.architecture')
    // Everything that sizes the cache precedes the tokenizer in llama.cpp's own conversions.
    if (key.startsWith('tokenizer.') && typeof arch === 'string' && keys.has(`${arch}.block_count`))
      break
    keys.set(key, r.value(type))
  }
  return keys
}

const num = (v: Value | undefined): number | null => (typeof v === 'number' ? v : null)

/** Per-layer list from a scalar or an array key. */
function perLayer(v: Value | undefined, layers: number, fallback: number): number[] {
  if (Array.isArray(v)) return Array.from({ length: layers }, (_, i) => num(v[i]) ?? 0)
  return Array(layers).fill(num(v) ?? fallback) as number[]
}

export function shapeOf(keys: Map<string, Value>): ModelShape | null {
  const arch = keys.get('general.architecture')
  if (typeof arch !== 'string') return null
  const at = (name: string) => keys.get(`${arch}.${name}`)
  const layers = num(at('block_count'))
  if (!layers) return null
  const embedding = num(at('embedding_length'))
  const heads = perLayer(at('attention.head_count'), layers, 0)
  const kvHeads = perLayer(at('attention.head_count_kv'), layers, heads[0] ?? 0)
  const headDim = embedding && heads[0] ? embedding / heads[0] : 128
  const pattern = at('attention.sliding_window_pattern')
  return {
    architecture: arch,
    layers,
    contextLength: num(at('context_length')),
    kvHeads,
    keyLength: num(at('attention.key_length')) ?? headDim,
    valueLength: num(at('attention.value_length')) ?? headDim,
    slidingWindow: num(at('attention.sliding_window')),
    slidingLayers: Array.isArray(pattern) ? pattern.map((p) => p === true || p === 1) : null,
    sharedKvLayers: num(at('attention.shared_kv_layers')) ?? 0,
    fullAttentionInterval: num(at('full_attention_interval')),
    experts: num(at('expert_count')),
    expertsUsed: num(at('expert_used_count')),
  }
}

const FIRST_READ = 128 * 1024
const MAX_READ = 16 * 1024 * 1024

/** Read growing prefixes until the header fits: most take one read, a long one a few. */
async function shapeFromPrefix(read: (bytes: number) => Promise<Uint8Array>) {
  let size = FIRST_READ
  for (;;) {
    const bytes = await read(size)
    try {
      return shapeOf(readGgufMetadata(bytes))
    } catch (err) {
      if (!(err instanceof NeedMoreBytes) || bytes.byteLength < size || size >= MAX_READ) throw err
      size = Math.min(MAX_READ, Math.max(size * 4, err.needed + FIRST_READ))
    }
  }
}

/** The shape of a remote GGUF, read with Range requests — nothing else of the file downloads. */
export function fetchShape(
  url: string,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<ModelShape | null> {
  const fetchImpl = options.fetchImpl ?? fetch
  return shapeFromPrefix(async (size) => {
    const res = await fetchImpl(url, {
      headers: { range: `bytes=0-${size - 1}` },
      redirect: 'follow',
      signal: options.signal ?? AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`The model header answered ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  })
}

/** The shape of a GGUF on disk (an installed model). */
export function readShape(file: string): Promise<ModelShape | null> {
  return shapeFromPrefix(
    async (size) => new Uint8Array(await Bun.file(file).slice(0, size).arrayBuffer()),
  )
}
