import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { bitsPerWeight, estimatedSpecs } from './hf-catalog'
import { createHfClient, HfRateLimited, type HfClient, type HfModel } from './hf-client'
import { createJsonFile } from './json-file'
import { createListings } from './listings'

const dirs: string[] = []
const temp = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'localix-catalog-'))
  dirs.push(dir)
  return dir
}
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})

const row: HfModel = {
  id: 'ggml-org/gemma-4-E4B-it-GGUF',
  sha: 'c1',
  pipeline_tag: 'any-to-any',
  gguf: { total: 8e9, context_length: 131072, chat_template: '{{ enable_thinking }}' },
  cardData: { base_model: ['google/gemma-4-E4B-it'] },
  siblings: [
    { rfilename: 'gemma-4-E4B-it-Q4_K_M.gguf' },
    { rfilename: 'gemma-4-E4B-it-Q8_0.gguf' },
    { rfilename: 'mmproj-gemma-4-E4B-it-Q8_0.gguf' },
    { rfilename: 'eagle3-gemma-Q8_0.gguf' },
  ],
}

describe('cards from one list row', () => {
  test('variants are sized from parameters and real bits per weight; nothing is verifiable', () => {
    const specs = estimatedSpecs(row)
    expect(specs.map((s) => s.variant)).toEqual(['Q4_K_M', 'Q8_0'])
    const q4 = specs[0]!
    expect(q4.bytes).toBe(Math.round((8e9 * 4.85) / 8) + 0.6e9)
    expect(q4).toMatchObject({ vision: true, reasoning: true, baseModel: 'google/gemma-4-E4B-it' })
    expect(q4.files.every((f) => f.sha256 === '')).toBe(true)
  })

  test('bits per weight read any publisher’s quant names', () => {
    expect(bitsPerWeight('UD-Q4_K_XL')).toBeCloseTo(5.05)
    expect(bitsPerWeight('IQ1_S')).toBe(1.56)
    expect(bitsPerWeight('MXFP4')).toBe(4.25)
    expect(bitsPerWeight('vicuna')).toBeNull()
  })
})

function countingHf(answer: () => Promise<HfModel[]>) {
  let calls = 0
  const hf: HfClient = {
    models: () => {
      calls += 1
      return answer()
    },
    repo: async () => {
      throw new Error('unused')
    },
    meta: async () => {
      throw new Error('unused')
    },
  }
  return { hf, calls: () => calls }
}

describe('listings', () => {
  test('one request for readers at once; stale beats empty when Hugging Face is down', async () => {
    let up = true
    let now = 0
    const { hf, calls } = countingHf(async () => {
      if (!up) throw new HfRateLimited()
      await Bun.sleep(5)
      return [row]
    })
    const listings = createListings({ root: await temp(), hf, now: () => now })
    const query = { author: 'ggml-org', limit: 1000 }
    const [a, b] = await Promise.all([
      listings.browse('chat', query),
      listings.browse('chat', query),
    ])
    expect(a).toEqual([row])
    expect(b).toEqual([row])
    expect(calls()).toBe(1)
    up = false
    now = 7 * 60 * 60_000
    expect(await listings.browse('chat', query)).toEqual([row])
  })
})

describe('Hugging Face client', () => {
  test('after a 429 every call fails fast for a minute, without asking', async () => {
    let asked = 0
    let now = 0
    const hf = createHfClient(
      (async () => {
        asked += 1
        return new Response('slow down', { status: 429 })
      }) as unknown as typeof fetch,
      { now: () => now },
    )
    await expect(hf.models({ limit: 1 })).rejects.toBeInstanceOf(HfRateLimited)
    await expect(hf.meta('a/b')).rejects.toBeInstanceOf(HfRateLimited)
    expect(asked).toBe(1)
    now = 61_000
    await expect(hf.meta('a/b')).rejects.toBeInstanceOf(HfRateLimited)
    expect(asked).toBe(2)
  })
})

describe('json file', () => {
  test('writes atomically, coalesces a burst, and reads another version as empty', async () => {
    const dir = await temp()
    const file = path.join(dir, 'cache.json')
    const store = createJsonFile<{ n: number }>(file, 2)
    store.save(() => ({ n: 1 }))
    store.save(() => ({ n: 2 }))
    await store.flush()
    expect(await store.read()).toEqual({ n: 2 })
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([])
    expect(await createJsonFile(file, 3).read()).toBeNull()
  })
})

describe('parameter counts', () => {
  test('a count read from a small file yields to the size the name states', async () => {
    const { parametersOf } = await import('./hf-catalog')
    expect(
      parametersOf({ id: 'ggml-org/Nemotron-Super-VL-120B-A12B-GGUF', gguf: { total: 1.7e9 } }),
    ).toBe(120e9)
    expect(parametersOf({ id: 'ggml-org/Qwen3.6-35B-A3B-GGUF', gguf: { total: 34.7e9 } })).toBe(
      34.7e9,
    )
    expect(parametersOf({ id: 'ggml-org/gemma-4-E4B-it-GGUF', gguf: { total: 7.5e9 } })).toBe(7.5e9)
  })
})

describe('consistent sizes within a list', () => {
  test('a conversion reporting a tiny count takes its siblings’ count for the same original', async () => {
    const { withConsistentParameters } = await import('./candidates')
    const base = { cardData: { base_model: 'deepseek-ai/DeepSeek-V4.1-Flash' } }
    const [small, big] = withConsistentParameters([
      { id: 'a/DeepSeek-V4.1-Flash-DS4-Q4', gguf: { total: 0.5e9 }, ...base },
      { id: 'b/DeepSeek-V4.1-Flash-GGUF', gguf: { total: 284e9 }, ...base },
    ])
    expect(small!.gguf?.total).toBe(284e9)
    expect(big!.gguf?.total).toBe(284e9)
  })
})

describe('quant names in file names', () => {
  test('wherever the publisher put it', async () => {
    const { variantOfFile } = await import('./hf-catalog')
    expect(variantOfFile('gemma-4-E2B-it-Q4_0.gguf')).toBe('Q4_0')
    expect(variantOfFile('gemma-4-E4B_q4_0-it.gguf')).toBe('q4_0')
    expect(variantOfFile('Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL-00001-of-00002.gguf')).toBe(
      'UD-Q4_K_XL',
    )
    expect(variantOfFile('moondream2-text-model-f16_ct-vicuna.gguf')).toBeNull()
  })
})

describe('drafters are not chat models', () => {
  test('a speculative-decoding drafter repository is left out of the chat list', async () => {
    const { isChatCandidate } = await import('./candidates')
    expect(isChatCandidate({ id: 'LiquidAI/LFM2.5-2.6B-DSpark-GGUF' })).toBe(false)
    expect(isChatCandidate({ id: 'magnitudedev/gemma-4-E2B-it-qat-MTP-GGUF' })).toBe(false)
    expect(isChatCandidate({ id: 'LiquidAI/LFM2.5-2.6B-GGUF' })).toBe(true)
  })
})

describe('what the trending list keeps', () => {
  test('a full model with its own MTP head is a chat model; a small drafter and a LoRA are not', async () => {
    const { isChatCandidate } = await import('./candidates')
    expect(
      isChatCandidate({ id: 'HauhauCS/Qwen3.8-27B-Uncensored-MTP-GGUF', gguf: { total: 27e9 } }),
    ).toBe(true)
    expect(
      isChatCandidate({ id: 'magnitudedev/gemma-4-E2B-it-qat-MTP-GGUF', gguf: { total: 0.08e9 } }),
    ).toBe(false)
    expect(isChatCandidate({ id: 'codacus/Qwen3.6-35B-A3B-MicroTurn-Duplex-LoRA' })).toBe(false)
  })

  test('a repository whose one build names no quant is listed, unsized until its files are read', () => {
    const [spec] = estimatedSpecs({
      id: 'nvidia/Nemotron-Bolt-74B-GGUF',
      sha: 'c',
      gguf: { total: 74e9 },
      siblings: [
        { rfilename: 'Nemotron-Bolt-74B-24GB.gguf' },
        { rfilename: 'mmproj-Nemotron.gguf' },
      ],
    })
    expect(spec).toMatchObject({ variant: 'GGUF', bytes: 0, vision: true })
  })
})

describe('the labs’ models in the list', () => {
  test('a lab’s own build or a converter’s quantization of it; no fine-tunes', async () => {
    const { isOriginalModel, originalKey } = await import('./publishers')
    const of = (id: string, base?: string) => ({ id, cardData: base ? { base_model: base } : null })
    expect(isOriginalModel(of('Qwen/Qwen3-8B-GGUF', 'Qwen/Qwen3-8B'))).toBe(true)
    expect(isOriginalModel(of('unsloth/Qwen3-8B-GGUF', 'Qwen/Qwen3-8B'))).toBe(true)
    expect(isOriginalModel(of('DavidAU/Qwen3-8B-Heretic-GGUF', 'Qwen/Qwen3-8B'))).toBe(false)
    expect(isOriginalModel(of('unsloth/Some-Finetune-GGUF', 'someone/finetune'))).toBe(false)
    // Google's QAT build and the plain conversions are one original model.
    expect(
      originalKey(
        of('google/gemma-4-E4B-it-qat-q4_0-gguf', 'google/gemma-4-E4B-it-qat-q4_0-unquantized'),
      ),
    ).toBe(originalKey(of('ggml-org/gemma-4-E4B-it-GGUF', 'google/gemma-4-E4B-it')))
  })
})
