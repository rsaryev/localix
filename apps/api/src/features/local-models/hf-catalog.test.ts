import { describe, expect, test } from 'bun:test'
import { kindOf, labelOf, specsFromRepo } from './hf-catalog'
import type { HfRepoInfo } from './hf-client'

const file = (rfilename: string, size: number) => ({
  rfilename,
  size,
  lfs: { sha256: `sha-${rfilename}` },
})

const gemma: HfRepoInfo = {
  id: 'ggml-org/gemma-4-E2B-it-GGUF',
  sha: 'abc123',
  pipeline_tag: 'any-to-any',
  cardData: { license: 'apache-2.0' },
  gguf: { architecture: 'gemma4', context_length: 131072 },
  siblings: [
    { rfilename: 'README.md', size: 600 },
    file('gemma-4-E2B-it-Q4_0.gguf', 2_841_481_184),
    file('gemma-4-E2B-it-Q8_0.gguf', 4_967_497_152),
    file('mmproj-gemma-4-E2B-it-BF16.gguf', 986_833_664),
    file('mmproj-gemma-4-E2B-it-Q8_0.gguf', 557_368_064),
    file('mtp-gemma-4-E2B-it-Q4_0.gguf', 59_235_872),
  ],
}

describe('specsFromRepo', () => {
  test('one spec per variant, pinned to the commit, with the Q8_0 projector and no draft heads', () => {
    const specs = specsFromRepo(gemma)
    expect(specs.map((s) => s.id)).toEqual([
      'ggml-org/gemma-4-E2B-it-GGUF:Q4_0',
      'ggml-org/gemma-4-E2B-it-GGUF:Q8_0',
    ])
    const [q4] = specs
    expect(q4).toMatchObject({
      kind: 'chat',
      vision: true,
      contextLength: 131072,
      license: 'apache-2.0',
    })
    expect(q4!.files.map((f) => [f.name, f.role])).toEqual([
      ['gemma-4-E2B-it-Q4_0.gguf', 'weights'],
      ['mmproj-gemma-4-E2B-it-Q8_0.gguf', 'projector'],
    ])
    expect(q4!.files[0]!.url).toBe(
      'https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF/resolve/abc123/gemma-4-E2B-it-Q4_0.gguf',
    )
    expect(q4!.bytes).toBe(2_841_481_184 + 557_368_064)
  })

  test('a split variant needs every shard; an incomplete one is not offered', () => {
    const specs = specsFromRepo({
      id: 'x/big-GGUF',
      sha: 's',
      pipeline_tag: 'text-generation',
      siblings: [
        file('Q4_K_M/big-Q4_K_M-00001-of-00002.gguf', 10),
        file('Q4_K_M/big-Q4_K_M-00002-of-00002.gguf', 10),
        file('Q8_0/big-Q8_0-00001-of-00002.gguf', 20),
      ],
    })
    expect(specs.map((s) => [s.variant, s.files.length, s.bytes])).toEqual([['Q4_K_M', 2, 20]])
  })

  test('embedding repos are embedding models; rerankers are not offered', () => {
    expect(kindOf('feature-extraction')).toBe('embedding')
    expect(kindOf('text-ranking')).toBeNull()
    expect(specsFromRepo({ ...gemma, pipeline_tag: 'text-ranking' })).toEqual([])
    expect(labelOf('ggml-org/gemma-4-E2B-it-GGUF')).toBe('Gemma 4 E2B')
    expect(labelOf('google/gemma-4-12B-it-qat-q4_0-gguf')).toBe('Gemma 4 12B')
    expect(labelOf('google/gemma-4-26B-A4B-it-qat-q4_0-gguf')).toBe('Gemma 4 26B-A4B')
    expect(labelOf('bartowski/google_gemma-4-26B-A4B-it-GGUF')).toBe('Gemma 4 26B-A4B')
    expect(labelOf('ggml-org/Qwen3-4B-Thinking-2507-Q8_0-GGUF')).toBe('Qwen3 4B Thinking 2507')
  })

  test('files without a hash cannot be verified and are skipped', () => {
    const specs = specsFromRepo({ ...gemma, siblings: [{ rfilename: 'm-Q4_0.gguf', size: 5 }] })
    expect(specs).toEqual([])
  })
})

describe('repository files that are not variants', () => {
  test('draft heads, projectors named in the middle and non-quant names are left out', () => {
    const file = (rfilename: string, size = 10) => ({ rfilename, size, lfs: { sha256: 'h' } })
    const specs = specsFromRepo({
      id: 'ggml-org/gpt-oss-20b-GGUF',
      sha: 'r',
      pipeline_tag: 'text-generation',
      siblings: [
        file('eagle3-gpt-oss-20b-BF16.gguf'),
        file('eagle3-gpt-oss-20b-Q8_0.gguf'),
        file('gpt-oss-20b-MXFP4.gguf', 12),
      ],
    })
    expect(specs.map((s) => s.variant)).toEqual(['MXFP4'])
    const moondream = specsFromRepo({
      id: 'ggml-org/moondream2-GGUF',
      sha: 'r',
      siblings: [
        file('moondream2-mmproj-f16-20250414.gguf'),
        file('moondream2-text-model-f16_ct-vicuna.gguf'),
      ],
    })
    // Its one build names no quant: listed as the repository's single build, not dropped.
    expect(moondream.map((s) => s.variant)).toEqual(['GGUF'])
  })
})
