import { describe, expect, test } from 'bun:test'
import { NeedMoreBytes, readGgufMetadata, shapeOf } from './gguf-header'

/** A GGUF header written the way llama.cpp's converter writes one. */
function gguf(entries: Array<[string, 'u32' | 'str' | 'arr-i32' | 'arr-bool', unknown]>) {
  const parts: number[] = []
  const u32 = (v: number) => parts.push(...new Uint8Array(new Uint32Array([v]).buffer))
  const u64 = (v: number) => parts.push(...new Uint8Array(new BigUint64Array([BigInt(v)]).buffer))
  const str = (s: string) => {
    const bytes = new TextEncoder().encode(s)
    u64(bytes.length)
    parts.push(...bytes)
  }
  u32(0x46554747)
  u32(3)
  u64(0)
  u64(entries.length)
  for (const [key, type, value] of entries) {
    str(key)
    if (type === 'u32') {
      u32(4)
      u32(value as number)
    } else if (type === 'str') {
      u32(8)
      str(value as string)
    } else {
      const items = value as Array<number | boolean>
      u32(9)
      u32(type === 'arr-i32' ? 5 : 7)
      u64(items.length)
      for (const item of items) {
        if (type === 'arr-i32') u32(item as number)
        else parts.push(item ? 1 : 0)
      }
    }
  }
  return new Uint8Array(parts)
}

const qwen = gguf([
  ['general.architecture', 'str', 'qwen3'],
  ['qwen3.block_count', 'u32', 4],
  ['qwen3.context_length', 'u32', 40960],
  ['qwen3.embedding_length', 'u32', 2048],
  ['qwen3.attention.head_count', 'u32', 16],
  ['qwen3.attention.head_count_kv', 'u32', 8],
  ['qwen3.attention.key_length', 'u32', 128],
  ['qwen3.attention.value_length', 'u32', 128],
  ['tokenizer.ggml.model', 'str', 'gpt2'],
])

describe('GGUF header', () => {
  test('reads the keys that size the cache, and stops at the vocabulary', () => {
    const keys = readGgufMetadata(qwen)
    expect(keys.has('tokenizer.ggml.model')).toBe(false)
    expect(shapeOf(keys)).toMatchObject({
      architecture: 'qwen3',
      layers: 4,
      contextLength: 40960,
      kvHeads: [8, 8, 8, 8],
      keyLength: 128,
      slidingLayers: null,
    })
  })

  test('per-layer arrays: sliding layers and layers without a cache', () => {
    const shape = shapeOf(
      readGgufMetadata(
        gguf([
          ['general.architecture', 'str', 'gemma4'],
          ['gemma4.block_count', 'u32', 3],
          ['gemma4.attention.head_count', 'u32', 8],
          ['gemma4.attention.head_count_kv', 'arr-i32', [2, 0, 2]],
          ['gemma4.attention.sliding_window', 'u32', 512],
          ['gemma4.attention.sliding_window_pattern', 'arr-bool', [true, false, false]],
          ['gemma4.attention.shared_kv_layers', 'u32', 1],
        ]),
      ),
    )
    expect(shape).toMatchObject({
      kvHeads: [2, 0, 2],
      slidingWindow: 512,
      slidingLayers: [true, false, false],
      sharedKvLayers: 1,
    })
  })

  test('a header cut short asks for more bytes instead of guessing', () => {
    expect(() => readGgufMetadata(qwen.slice(0, 60))).toThrow(NeedMoreBytes)
  })

  test('a file that is not GGUF is refused', () => {
    expect(() => readGgufMetadata(new Uint8Array(64))).toThrow('Not a GGUF file')
  })
})
