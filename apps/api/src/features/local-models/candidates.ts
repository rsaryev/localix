/**
 * Which repositories the catalog offers, by what they are for — pure rules over list rows.
 * A chat list leaves out fixtures, models for something else (speech, OCR, reranking) and the
 * pretrained twin of an instruct model; an embedding list keeps embedding repositories only.
 */
import { originalOf, parametersOf } from './hf-catalog'
import type { HfModel } from './hf-client'

/** Chat-capable pipelines; an untagged GGUF repo is usually a chat model too. */
const CHAT_TAGS = new Set(['text-generation', 'image-text-to-text', 'any-to-any', 'conversational'])
/** Repositories that are fixtures or models for something else (speech, OCR, reranking). */
const NOT_FOR_CHAT =
  /(^|[-_/])(test|tiny|stories|moved|testing|asr|tts|audio|reranker|voxtral|whisper|embed|lora)|ocr/i
/**
 * A draft model for speculative decoding: it helps another model, it does not answer. Named for
 * its method — but so is a full model with its own MTP head (`Qwen3.8-27B-…-MTP`), so only a
 * small one is a drafter.
 */
const DRAFTER = /-(mtp|dflash2?|dspark|eagle3?)(-|$)/i
const DRAFTER_MAX_PARAMETERS = 2e9
/** A pretrained base model: it continues text, it does not answer. */
const BASE_MODEL = /(^|[-_])(base|pt)([-_]|$)/i
/** Words that mark the instruction-tuned release of a model. */
const INSTRUCT = /-(it|instruct|chat|thinking)(?=-|$)/i

const nameOf = (repo: string) => (repo.split('/').pop() ?? '').replace(/-GGUF$/i, '')

export function isChatCandidate(row: Pick<HfModel, 'id' | 'pipeline_tag' | 'gguf'>): boolean {
  const name = nameOf(row.id)
  if (NOT_FOR_CHAT.test(name) || BASE_MODEL.test(name)) return false
  // The reported count, not the name's: a drafter's name carries its target's size.
  if (DRAFTER.test(name) && (row.gguf?.total ?? 0) < DRAFTER_MAX_PARAMETERS) return false
  return !row.pipeline_tag || CHAT_TAGS.has(row.pipeline_tag)
}

/** `gemma-4-E4B` beside `gemma-4-E4B-it`: the pretrained twin of an instruct model is left out. */
export function withoutPretrainedTwins<T extends { repo: string }>(groups: readonly T[]): T[] {
  const key = (repo: string) => repo.toLowerCase().replace(/-gguf$/i, '')
  const instructBases = new Set(
    groups.filter((g) => INSTRUCT.test(g.repo)).map((g) => key(g.repo).replace(INSTRUCT, '')),
  )
  return groups.filter((g) => INSTRUCT.test(g.repo) || !instructBases.has(key(g.repo)))
}

/** Rows once each, the first occurrence kept (lists merge in order of trust). */
export function uniqueRows(rows: readonly HfModel[]): HfModel[] {
  const seen = new Set<string>()
  return rows.filter((row) => !seen.has(row.id) && seen.add(row.id))
}

/**
 * Conversions of one original have its parameter count. Hugging Face reads a count from one
 * file, which in a multi-file repository can be a small one — so within a list, a count far
 * below its siblings' (same original) takes theirs. A card then never shows a 284B model as
 * a 0.3 GB download.
 */
export function withConsistentParameters(rows: readonly HfModel[]): HfModel[] {
  const largest = new Map<string, number>()
  for (const row of rows) {
    const original = originalOf(row)
    const count = parametersOf(row) ?? 0
    if (original && count > (largest.get(original) ?? 0)) largest.set(original, count)
  }
  return rows.map((row) => {
    const original = originalOf(row)
    const best = original ? largest.get(original) : undefined
    const count = parametersOf(row) ?? 0
    return best && count < best * 0.5 ? { ...row, gguf: { ...row.gguf, total: best } } : row
  })
}
