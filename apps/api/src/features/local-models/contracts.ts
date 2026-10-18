/**
 * Local models — models that run on this computer, through the managed llama.cpp runtime.
 *
 * One vocabulary for every kind: a chat model behind the `local` provider and the embedding
 * model behind semantic search are both a {@link LocalModelSpec}, downloaded by the same
 * installer, verified the same way and served by the same process pool. A kind-specific
 * feature (embeddings, chat) adds its own behaviour on top and never re-implements these.
 */

import type { Accelerator } from './machine'
import type { ModelPlan } from './planner'

export type LocalModelKind = 'chat' | 'embedding'

/** llama.cpp speculative decoding a separate draft model can drive. */
export type DraftMethod = 'mtp' | 'dflash' | 'dspark'

export interface LocalModelFile {
  name: string
  url: string
  bytes: number
  /** Hugging Face's LFS sha256 for this revision; the download must match it. */
  sha256: string
  /**
   * `weights` is loaded with `-m` (its first shard when split), `projector` with `--mmproj`, and
   * `draft` — a small model that proposes tokens the main one verifies, for faster replies — with
   * `--model-draft`.
   */
  role: 'weights' | 'projector' | 'draft'
}

export interface LocalModelSpec {
  /** Stable id: `<repo>:<variant>`, e.g. `ggml-org/gemma-4-E2B-it-GGUF:Q4_0`. */
  id: string
  repo: string
  /** The commit every file URL is pinned to. A new revision is a new download. */
  revision: string
  variant: string
  kind: LocalModelKind
  label: string
  /** Licence id from the model card, when it declares one. */
  license: string | null
  architecture: string | null
  contextLength: number | null
  /** Accepts images (a projector file is part of the download). */
  vision: boolean
  files: LocalModelFile[]
  bytes: number
  /** When the repository was published, and the model's parameter count, when known. */
  releasedAt?: string | null
  parameters?: number | null
  /** The original model this converts (`deepseek-ai/DeepSeek-V4.1-Flash`), from the card. */
  baseModel?: string | null
  /** Its chat template can think before answering (`enable_thinking`, a reasoning effort). */
  reasoning?: boolean
  /** The draft model shipped with this one (a `draft` file), and who published it. */
  draft?: { method: DraftMethod; repo: string } | null
}

export interface ModelVariant {
  id: string
  variant: string
  bytes: number
  fit: ModelPlan['fit']
}

/**
 * A catalog row: one model, at the variant that suits this computer best (or the one installed),
 * with how it would run here and the other variants on offer.
 */
export interface LocalModelEntry {
  spec: LocalModelSpec
  installed: boolean
  /** The pick recommended for this computer. */
  featured: boolean
  /** Null when this computer's profile is not known yet. */
  plan: ModelPlan | null
  downloads: number | null
  variants: ModelVariant[]
  /**
   * Sizes and files read from the repository (true), or worked out from the list's parameter
   * count (false) until the model is shown in detail.
   */
  exact: boolean
  /** Installed, and the catalog's spec adds files (a draft model): what fetching them costs. */
  upgradeBytes?: number
  /** A recommended choice's scores, each in [0, 1], weighed by the person's preference. */
  scores?: RecommendScores
}

/** How a recommended choice compares with the others that run on this computer. */
export interface RecommendScores {
  /** The model's size within its family: larger answers better. */
  intelligence: number
  /** Expected generation speed on this computer. */
  speed: number
  /** How much of the original the variant keeps. */
  fidelity: number
}

/** This computer, as the catalog judged it. */
export interface MachineSummary {
  chip: string | null
  accelerator: Accelerator
  memoryBytes: number
  /** Memory models may take here. */
  modelBytes: number
  source: 'runtime' | 'estimate'
}

export type InstallPhase = 'queued' | 'downloading' | 'verifying' | 'failed' | 'cancelled'

export interface InstallJob {
  modelId: string
  /** The model's name, for the rows and the composer's download line. */
  label: string
  /** Fetched ahead of need (`background.ts`), not asked for: it downloads without a notice. */
  background: boolean
  phase: InstallPhase
  received: number
  total: number
  /** Bytes per second over the last few seconds, for an ETA. */
  rate: number | null
  error: string | null
}

/** A download stopped part-way (paused, or interrupted by a restart): its files stay on disk. */
export interface PausedDownload {
  modelId: string
  label: string
  /** Bytes already on disk; resuming continues from here. */
  received: number
  total: number
  /** Fetched ahead of need (`background.ts`): paused without a notice. */
  background: boolean
}

export interface RuntimeStatus {
  supported: boolean
  tag: string | null
  installed: boolean
}

export interface RunningModel {
  modelId: string
  mode: LocalModelKind
  state: 'starting' | 'ready'
  sinceMs: number
}

export interface LocalModelsStatus {
  runtime: RuntimeStatus
  installed: LocalModelSpec[]
  jobs: InstallJob[]
  paused: PausedDownload[]
  running: RunningModel[]
  /** Bytes the installed models take on disk. */
  diskBytes: number
  machine: MachineSummary | null
}
