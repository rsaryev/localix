import { describe, expect, test } from 'bun:test'
import type { LocalModelSpec } from './contracts'
import { profileFrom } from './machine'
import { fidelityScore, recommendOptions, speedScore } from './recommend'

const GB = 1e9
const machine = profileFrom({
  platform: 'darwin',
  arch: 'arm64',
  memoryBytes: 24 * 2 ** 30,
  cpu: 'Apple M5',
  devices: null,
})

function spec(repo: string, variant: string, bytes: number, baseModel: string): LocalModelSpec {
  return {
    id: `${repo}:${variant}`,
    repo,
    revision: 'r',
    variant,
    kind: 'chat',
    label: repo,
    license: null,
    architecture: null,
    contextLength: 65536,
    vision: false,
    files: [{ name: `${variant}.gguf`, url: 'u', bytes, sha256: 's', role: 'weights' }],
    bytes,
    baseModel,
  }
}

const options = (specs: LocalModelSpec[]) =>
  recommendOptions({
    groups: specs.map((s) => ({ repo: s.repo, specs: [s], downloads: 1 })),
    installed: [],
    machine,
    shapeOf: () => null,
  })

describe('recommended choices', () => {
  test('speed saturates and Google QAT Q4_0 keeps more than a post-training Q4', () => {
    expect(speedScore(0)).toBe(0)
    expect(speedScore(100) - speedScore(60)).toBeLessThan(speedScore(30) - speedScore(10))
    expect(fidelityScore('Q4_0', true)).toBeGreaterThan(fidelityScore('Q4_K_M', false))
    expect(fidelityScore('Q8_0', false)).toBeGreaterThan(fidelityScore('Q3_K_M', false))
  })

  test('one build per original and width, the lab first; finer mixes and misfits left out', () => {
    const e4b = 'google/gemma-4-E4B-it'
    const big = 'google/gemma-4-31B-it'
    const picked = options([
      spec('google/gemma-4-E4B-it-qat-q4_0-gguf', 'Q4_0', 2 * GB, e4b),
      spec('unsloth/gemma-4-E4B-it-GGUF', 'Q4_0', 2 * GB, e4b),
      spec('unsloth/gemma-4-E4B-it-GGUF', 'Q4_K_M', 2.1 * GB, e4b),
      spec('ggml-org/gemma-4-E4B-it-GGUF', 'Q4_K_M', 2.1 * GB, e4b),
      spec('unsloth/gemma-4-E4B-it-GGUF', 'UD-IQ3_XXS', 2.5 * GB, e4b),
      spec('google/gemma-4-31B-it-qat-q4_0-gguf', 'Q4_0', 60 * GB, big),
    ])
    expect(picked.map((e) => e.spec.id).sort()).toEqual([
      'ggml-org/gemma-4-E4B-it-GGUF:Q4_K_M',
      'google/gemma-4-E4B-it-qat-q4_0-gguf:Q4_0',
    ])
    // The largest size in the family sets the scale, though it does not fit here.
    expect(picked[0]!.scores!.intelligence).toBeLessThan(1)
  })
})
