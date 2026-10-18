/**
 * The one model pinned in code: semantic search's embedding model. Its vector space must never
 * move to a new commit, so its files and hashes live here in full. Chat models are not listed
 * anywhere in code — the catalog reads them from Hugging Face and plans them for this computer.
 */
import type { LocalModelSpec } from './contracts'
import { HF_BASE } from './hf-client'

const EMBEDDING_REPO = 'ggml-org/embeddinggemma-2-GGUF'
const EMBEDDING_REVISION = 'bfcd298762cc34d0357ece5ebdd31791a3a374d8'
const EMBEDDING_FILE = 'embeddinggemma-2-Q8_0.gguf'

/**
 * EmbeddingGemma 2 (Google, Apache 2.0), text model at Q8_0. Never F16: its activations
 * overflow float16 and produce NaN or silently degraded vectors (model card).
 */
export const EMBEDDINGGEMMA_2_MODEL: LocalModelSpec = {
  id: `${EMBEDDING_REPO}:Q8_0`,
  repo: EMBEDDING_REPO,
  revision: EMBEDDING_REVISION,
  variant: 'Q8_0',
  kind: 'embedding',
  label: 'EmbeddingGemma 2',
  license: 'apache-2.0',
  architecture: 'gemma-embedding2',
  contextLength: 8192,
  vision: false,
  files: [
    {
      name: EMBEDDING_FILE,
      url: `${HF_BASE}/${EMBEDDING_REPO}/resolve/${EMBEDDING_REVISION}/${EMBEDDING_FILE}`,
      bytes: 309_855_456,
      sha256: '2188ac1deca4b77dffefd603c2776a9d76d9d74ec01841392982ebb840b09135',
      role: 'weights',
    },
  ],
  bytes: 309_855_456,
  releasedAt: '2026-10-06',
  baseModel: 'google/embeddinggemma-2',
}

export const PINNED_MODELS: readonly LocalModelSpec[] = [EMBEDDINGGEMMA_2_MODEL]
