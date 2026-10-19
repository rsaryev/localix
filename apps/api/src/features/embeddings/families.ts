/**
 * Embedding model families semantic search knows how to use well.
 *
 * Search runs on one model, chosen in code (EmbeddingGemma 2); its family is what using it
 * correctly takes beyond its weights: the prompts it was trained with on each side (a query is not
 * phrased like a passage), whether its vectors can be cut short (Matryoshka training) and how much
 * text one input may hold. The other families stay so the model can be changed here, in code,
 * without relearning them. Families are kept to multilingual retrieval models — conversations
 * here are not only in English.
 */
import type { SemanticTask } from '@localixai/plugin-sdk/backend'

export interface EmbeddingFamily {
  key: string
  match: RegExp
  /** Native width for one member when the family's members differ (Qwen3 0.6B/4B/8B). */
  dimensionsOf?(id: string): number
  /** The family's own name for a repository or model id ("EmbeddingGemma 2"). */
  name(id: string): string
  attribution: string
  /** Native output width. */
  dimensions: number
  /** Trained so a prefix of the vector is itself a good vector (store fewer dimensions). */
  matryoshka: boolean
  maxChunkChars: number
  /** Bumped when the prompts change: part of the index fingerprint. */
  promptVersion: number
  formatQuery(task: SemanticTask, text: string): string
  formatDocument(task: SemanticTask, title: string | undefined, text: string): string
}

/** Width the index stores for a Matryoshka model: a third of the memory, ~1.5% of the quality. */
export const MATRYOSHKA_INDEX_DIMENSIONS = 256

const GEMMA_TASK: Record<SemanticTask, string> = {
  search: 'search result',
  question: 'question answering',
  code: 'code retrieval',
  similarity: 'sentence similarity',
  classification: 'classification',
}
const SYMMETRIC: ReadonlySet<SemanticTask> = new Set(['similarity', 'classification'])

const QWEN_INSTRUCTION: Record<SemanticTask, string> = {
  search: 'Given a search query, retrieve relevant passages that answer the query',
  question: 'Given a question, retrieve passages that answer the question',
  code: 'Given a query, retrieve relevant code',
  similarity: 'Retrieve semantically similar text',
  classification: 'Classify the given text',
}

const plain = {
  formatQuery: (_task: SemanticTask, text: string) => text,
  formatDocument: (_task: SemanticTask, _title: string | undefined, text: string) => text,
}

export const EMBEDDING_FAMILIES: readonly EmbeddingFamily[] = [
  {
    key: 'embeddinggemma',
    match: /embeddinggemma/i,
    name: (id) => {
      const size = /embeddinggemma-(\d+(?:\.\d+)?[mb]?)/i.exec(id)?.[1] ?? ''
      return `EmbeddingGemma ${/^\d+$/.test(size) && Number(size) < 10 ? size : size.toUpperCase()}`.trim()
    },
    attribution: 'Google · Apache 2.0',
    dimensions: 768,
    matryoshka: true,
    maxChunkChars: 1600,
    promptVersion: 1,
    formatQuery: (task, text) => `task: ${GEMMA_TASK[task]} | query: ${text}`,
    formatDocument: (task, title, text) =>
      SYMMETRIC.has(task)
        ? `task: ${GEMMA_TASK[task]} | query: ${text}`
        : `title: ${title?.trim() || 'none'} | text: ${text}`,
  },
  {
    key: 'qwen3-embedding',
    match: /qwen3-embedding/i,
    name: (id) => `Qwen3 Embedding ${/embedding-(\d+(?:\.\d+)?B)/i.exec(id)?.[1] ?? ''}`.trim(),
    attribution: 'Qwen · Apache 2.0',
    dimensions: 1024,
    matryoshka: true,
    maxChunkChars: 1600,
    promptVersion: 1,
    dimensionsOf: (id) => (/8b/i.test(id) ? 4096 : /4b/i.test(id) ? 2560 : 1024),
    formatQuery: (task, text) => `Instruct: ${QWEN_INSTRUCTION[task]}\nQuery: ${text}`,
    formatDocument: (_task, _title, text) => text,
  },
  {
    key: 'nomic-embed-text-v2',
    match: /nomic-embed-text-v2/i,
    name: () => 'Nomic Embed Text v2',
    attribution: 'Nomic · Apache 2.0',
    dimensions: 768,
    matryoshka: true,
    // 512 tokens per input.
    maxChunkChars: 1400,
    promptVersion: 1,
    formatQuery: (_task, text) => `search_query: ${text}`,
    formatDocument: (_task, _title, text) => `search_document: ${text}`,
  },
  {
    key: 'bge-m3',
    match: /bge-m3/i,
    name: () => 'BGE-M3',
    attribution: 'BAAI · MIT',
    dimensions: 1024,
    matryoshka: false,
    maxChunkChars: 1600,
    promptVersion: 1,
    ...plain,
  },
  {
    key: 'openai-text-embedding-3',
    match: /text-embedding-3-(small|large)/i,
    name: (id) => `Text Embedding 3 ${/large/i.test(id) ? 'Large' : 'Small'}`,
    dimensionsOf: (id) => (/large/i.test(id) ? 3072 : 1536),
    attribution: 'OpenAI',
    dimensions: 1536,
    matryoshka: true,
    maxChunkChars: 1600,
    promptVersion: 1,
    ...plain,
  },
  {
    key: 'gemini-embedding',
    match: /gemini-embedding/i,
    name: () => 'Gemini Embedding',
    attribution: 'Google',
    dimensions: 3072,
    matryoshka: true,
    maxChunkChars: 1600,
    promptVersion: 1,
    ...plain,
  },
  {
    key: 'mistral-embed',
    match: /mistral-embed/i,
    name: () => 'Mistral Embed',
    attribution: 'Mistral AI',
    dimensions: 1024,
    matryoshka: false,
    maxChunkChars: 1600,
    promptVersion: 1,
    ...plain,
  },
]

export function familyOf(name: string): EmbeddingFamily | undefined {
  return EMBEDDING_FAMILIES.find((family) => family.match.test(name))
}
