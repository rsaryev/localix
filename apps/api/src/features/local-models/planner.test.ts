import { describe, expect, test } from 'bun:test'
import type { ModelShape } from './gguf-header'
import { profileFrom, parseDevices } from './machine'
import { activeFractionOf, cacheBytes, planModel } from './planner'

const GB = 1e9
const mac = (memoryGiB: number, chip = 'Apple M5') =>
  profileFrom({
    platform: 'darwin',
    arch: 'arm64',
    memoryBytes: memoryGiB * 2 ** 30,
    cpu: chip,
    devices: null,
  })

/** Qwen3 1.7B: 28 layers × 8 KV heads × 128+128 dims. */
const qwen: ModelShape = {
  architecture: 'qwen3',
  layers: 28,
  contextLength: 40960,
  kvHeads: Array(28).fill(8) as number[],
  keyLength: 128,
  valueLength: 128,
  slidingWindow: null,
  slidingLayers: null,
  sharedKvLayers: 0,
  fullAttentionInterval: null,
  experts: null,
  expertsUsed: null,
}

describe('planner', () => {
  test('cache per token matches llama.cpp: 1904 MiB at 32K for Qwen3 1.7B in q8_0', () => {
    const { perToken } = cacheBytes(qwen, 'q8_0', 1.28 * GB)
    expect(Math.round((perToken * 32768) / 2 ** 20)).toBe(1904)
  })

  test('sliding, shared and linear layers do not grow with the context', () => {
    const sliding = {
      ...qwen,
      slidingWindow: 512,
      slidingLayers: qwen.kvHeads.map((_, i) => i % 2 === 0),
    }
    expect(cacheBytes(sliding, 'f16', 1).perToken).toBe(cacheBytes(qwen, 'f16', 1).perToken / 2)
    const shared = { ...qwen, sharedKvLayers: 14 }
    expect(cacheBytes(shared, 'f16', 1).perToken).toBe(cacheBytes(qwen, 'f16', 1).perToken / 2)
    const hybrid = { ...qwen, fullAttentionInterval: 4 }
    expect(cacheBytes(hybrid, 'f16', 1).perToken).toBe(cacheBytes(qwen, 'f16', 1).perToken / 4)
  })

  test('a small model runs comfortably at a long context with the fast f16 cache', () => {
    const plan = planModel(
      { bytes: 1.28 * GB, streamedBytes: 1.28 * GB, shape: qwen, contextLength: 40960 },
      mac(24),
    )
    expect(plan).toMatchObject({ fit: 'good', context: 32768, kv: 'f16', offloaded: false })
    // Measured 84 tokens/s at depth 0 on an M5; the quote is at 4K depth.
    expect(plan.tokensPerSecond).toBeGreaterThan(45)
    expect(plan.tokensPerSecond).toBeLessThan(90)
  })

  test('a model too large for this computer says by how much', () => {
    const plan = planModel(
      { bytes: 21 * GB, streamedBytes: 2 * GB, shape: qwen, contextLength: 262144 },
      mac(16),
    )
    expect(plan.fit).toBe('too-large')
    expect(plan.shortBytes).toBeGreaterThan(5 * GB)
    expect(plan.tokensPerSecond).toBeNull()
  })

  test('tight memory trades the cache type before the context', () => {
    // Fits only when the cache is halved: q8_0 at a long context beats f16 at a short one.
    const plan = planModel(
      { bytes: 8 * GB, streamedBytes: 8 * GB, shape: qwen, contextLength: 65536 },
      mac(24),
    )
    expect(plan.fit).not.toBe('too-large')
    expect(plan.kv === 'q8_0' || plan.context < 32768).toBe(true)
  })

  test('a dedicated GPU spills what it cannot hold into system memory, slower', () => {
    const pc = profileFrom({
      platform: 'linux',
      arch: 'x64',
      memoryBytes: 64 * 2 ** 30,
      cpu: 'AMD Ryzen 9',
      devices: parseDevices('  CUDA0: NVIDIA GeForce RTX 4060 (8188 MiB, 7900 MiB free)'),
    })
    const plan = planModel(
      { bytes: 12 * GB, streamedBytes: 12 * GB, shape: qwen, contextLength: 32768 },
      pc,
    )
    expect(plan).toMatchObject({ fit: 'tight', offloaded: true })
  })

  test('active share from the name: mixture of experts and Gemma E-models', () => {
    expect(activeFractionOf('ggml-org/Qwen3.6-35B-A3B-GGUF', 34.7e9)).toBeCloseTo(0.095, 2)
    expect(activeFractionOf('ggml-org/gemma-4-E2B-it-GGUF', 4.63e9)).toBeCloseTo(0.648, 2)
    expect(activeFractionOf('ggml-org/Qwen3-1.7B-GGUF', 2e9)).toBe(1)
  })
})

describe('machine profile', () => {
  test('Apple Silicon plans with the Metal working set, less a reserve', () => {
    const fromRuntime = profileFrom({
      platform: 'darwin',
      arch: 'arm64',
      memoryBytes: 24 * 2 ** 30,
      cpu: 'Apple M5',
      devices: parseDevices(
        '  MTL0: Apple M5 (18186 MiB, 18185 MiB free)\n  BLAS: Accelerate (0 MiB, 0 MiB free)',
      ),
    })
    expect(fromRuntime).toMatchObject({ accelerator: 'metal', unified: true, source: 'runtime' })
    expect(fromRuntime.modelBytes).toBe(18186 * 2 ** 20 - 2.4 * 2 ** 30)
    expect(fromRuntime.bandwidth).toBe(153e9)
    // Before the runtime: macOS's own rule, three quarters above 16 GB.
    expect(mac(24).modelBytes).toBeCloseTo(18 * 2 ** 30 - 2.4 * 2 ** 30, -6)
  })

  test('a computer without a GPU plans with system memory', () => {
    const cpu = profileFrom({
      platform: 'linux',
      arch: 'x64',
      memoryBytes: 16 * 2 ** 30,
      cpu: 'Intel Xeon',
      devices: [],
    })
    expect(cpu).toMatchObject({ accelerator: 'cpu', modelBytes: 14 * 2 ** 30 })
  })
})
