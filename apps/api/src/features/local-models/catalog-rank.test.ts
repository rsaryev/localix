import { describe, expect, test } from 'bun:test'
import { bitsOf, buildEntries, pickVariant, sortEntries } from './catalog-rank'
import { isChatCandidate } from './candidates'
import type { LocalModelSpec } from './contracts'
import { parseDrafterRepo, targetKey } from './drafters'
import { profileFrom } from './machine'

const GB = 1e9
const machine = profileFrom({
  platform: 'darwin',
  arch: 'arm64',
  memoryBytes: 24 * 2 ** 30,
  cpu: 'Apple M5',
  devices: null,
})

function spec(
  repo: string,
  variant: string,
  bytes: number,
  releasedAt = '2026-01-01',
): LocalModelSpec {
  return {
    id: `${repo}:${variant}`,
    repo,
    revision: 'r',
    variant,
    kind: 'chat',
    label: repo,
    license: null,
    architecture: null,
    contextLength: 32768,
    vision: false,
    files: [{ name: `${variant}.gguf`, url: 'u', bytes, sha256: 's', role: 'weights' }],
    bytes,
    releasedAt,
  }
}

describe('catalog ranking', () => {
  test('a pick prefers 4-bit, moves to Q8_0 for a small fast model, never full precision', () => {
    const repo = 'ggml-org/Model-7B-GGUF'
    const plan = () => null
    expect(
      pickVariant(
        [spec(repo, 'F16', 14 * GB), spec(repo, 'Q8_0', 7 * GB), spec(repo, 'Q4_K_M', 4 * GB)],
        plan,
      )?.variant,
    ).toBe('Q4_K_M')
    const small = 'ggml-org/Model-1B-GGUF'
    const entries = buildEntries({
      groups: [
        {
          repo: small,
          specs: [spec(small, 'Q4_K_M', 0.7 * GB), spec(small, 'Q8_0', 1.1 * GB)],
          downloads: 1,
        },
      ],
      installed: [],
      machine,
      shapeOf: () => null,
    })
    expect(entries[0]!.spec.variant).toBe('Q8_0')
  })

  test('what runs here keeps the list order, ahead of what does not', () => {
    const entries = buildEntries({
      groups: [
        {
          repo: 'ggml-org/Old-3B-GGUF',
          specs: [spec('ggml-org/Old-3B-GGUF', 'Q4_0', 2 * GB, '2025-01-01')],
          downloads: 900,
        },
        {
          repo: 'ggml-org/Huge-120B-GGUF',
          specs: [spec('ggml-org/Huge-120B-GGUF', 'Q4_0', 60 * GB, '2026-09-01')],
          downloads: 50,
        },
        {
          repo: 'ggml-org/New-4B-GGUF',
          specs: [spec('ggml-org/New-4B-GGUF', 'Q4_0', 2.5 * GB, '2026-08-01')],
          downloads: 10,
        },
      ],
      installed: [],
      machine,
      shapeOf: () => null,
    })
    expect(sortEntries(entries).map((e) => e.spec.repo.split('/')[1])).toEqual([
      'Old-3B-GGUF',
      'New-4B-GGUF',
      'Huge-120B-GGUF',
    ])
    expect(entries.find((e) => e.spec.repo.endsWith('Huge-120B-GGUF'))!.plan!.fit).toBe('too-large')
  })

  test('fixtures and models for other jobs are not chat candidates', () => {
    expect(
      isChatCandidate({ id: 'ggml-org/gemma-4-E2B-it-GGUF', pipeline_tag: 'any-to-any' }),
    ).toBe(true)
    expect(isChatCandidate({ id: 'ggml-org/Qwen3-1.7B-GGUF' })).toBe(true)
    for (const id of [
      'ggml-org/tinygemma3-GGUF',
      'ggml-org/test-model-stories260K',
      'ggml-org/Qwen3-ASR-1.7B-GGUF',
      'ggml-org/GLM-OCR-GGUF',
    ])
      expect(isChatCandidate({ id })).toBe(false)
    expect(
      isChatCandidate({ id: 'ggml-org/Kev-4B-GGUF', pipeline_tag: 'text-classification' }),
    ).toBe(false)
  })
})

describe('drafter matching', () => {
  test('a drafter is matched to its target by name, less method and build qualifiers', () => {
    expect(parseDrafterRepo('magnitudedev/gemma-4-E2B-it-qat-MTP-GGUF')).toEqual({
      key: targetKey('ggml-org/gemma-4-E2B-it-GGUF'),
      method: 'mtp',
    })
    expect(parseDrafterRepo('magnitudedev/Qwen3.6-35B-A3B-DFlash-GGUF')?.key).toBe(
      targetKey('ggml-org/Qwen3.6-35B-A3B-GGUF'),
    )
    // DFlash2 is not a method the pinned runtime runs.
    expect(parseDrafterRepo('magnitudedev/Qwen3.8-27B-DFlash2-GGUF')).toBeNull()
  })
})

describe('variant widths', () => {
  test('bits come from the quant name, whatever the publisher calls it', () => {
    expect(
      ['Q4_K_M', 'UD-Q3_K_XL', 'IQ1_S', 'IQ4_XS', 'MXFP4', 'BF16', 'Q8_0', 'q8_0'].map(bitsOf),
    ).toEqual([4, 3, 1, 4, 4, 16, 8, 8])
  })

  test('a large model on a small computer gets a useful 3-bit, never a 1-bit one', () => {
    const repo = 'unsloth/Model-30B-GGUF'
    const plan = (s: LocalModelSpec) => ({
      fit:
        s.bytes > 16 * GB
          ? ('too-large' as const)
          : s.bytes > 10 * GB
            ? ('tight' as const)
            : ('good' as const),
      context: 8192,
      kv: 'f16' as const,
      memoryBytes: s.bytes,
      shortBytes: 0,
      offloaded: false,
      tokensPerSecond: 10,
    })
    const picked = pickVariant(
      [
        spec(repo, 'IQ1_S', 7 * GB),
        spec(repo, 'UD-Q3_K_XL', 13 * GB),
        spec(repo, 'Q4_K_M', 18 * GB),
      ],
      plan,
    )
    expect(picked?.variant).toBe('UD-Q3_K_XL')
  })
})

describe('chat candidates by name', () => {
  test('pretrained base models and audio models are not offered for chat', () => {
    expect(isChatCandidate({ id: 'ggml-org/Qwen3-8B-Base-GGUF' })).toBe(false)
    expect(isChatCandidate({ id: 'ggml-org/LFM2-Audio-1.5B-GGUF' })).toBe(false)
    expect(isChatCandidate({ id: 'ggml-org/gemma-4-E4B-it-GGUF' })).toBe(true)
  })
})

describe('downloaded first', () => {
  test('an installed model leads, ahead of newer models', () => {
    const old = spec('ggml-org/Old-3B-GGUF', 'Q4_0', 2 * GB, '2024-01-01')
    const entries = buildEntries({
      groups: [
        {
          repo: 'ggml-org/New-4B-GGUF',
          specs: [spec('ggml-org/New-4B-GGUF', 'Q4_0', 2 * GB, '2026-09-01')],
          downloads: 1,
        },
        {
          repo: 'ggml-org/gemma-4-E4B-it-GGUF',
          specs: [spec('ggml-org/gemma-4-E4B-it-GGUF', 'Q4_0', 3 * GB, '2026-03-01')],
          downloads: 1,
        },
        { repo: old.repo, specs: [old], downloads: 1 },
      ],
      installed: [old],
      machine,
      shapeOf: () => null,
    })
    expect(sortEntries(entries, { newest: true }).map((e) => e.spec.repo)).toEqual([
      'ggml-org/Old-3B-GGUF',
      'ggml-org/New-4B-GGUF',
      'ggml-org/gemma-4-E4B-it-GGUF',
    ])
  })
})
