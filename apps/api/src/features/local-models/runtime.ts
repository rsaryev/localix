/**
 * The runtime every local model runs on: llama.cpp's `llama-server`, pinned to one build per
 * platform (archive URL, byte size and sha256 — never "latest").
 *
 * b11600 is the first build whose embedding contexts reserve no logits
 * (`has_logits = !cparams.embeddings || graph_has_logits`); earlier builds allocated n_vocab
 * floats per token, 1 MiB per token with Gemma's 262k vocabulary. It also serves Gemma 4 chat
 * models and EmbeddingGemma 2. Linux and Windows use the CPU builds; GPU-vendor builds can be
 * offered later as alternative pins for the same tag.
 */
import type { LocalModelFile } from './contracts'

export interface RuntimeBuild {
  tag: string
  archive: Omit<LocalModelFile, 'role'> & { format: 'tar.gz' | 'zip' }
  /** Executable path inside the extracted folder. */
  executable: string
}

const LLAMA_TAG = 'b11600'
const LLAMA_RELEASE = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}`

/** `${process.platform}-${process.arch}` → the CPU/Metal build for it. */
const LLAMA_BUILDS: Record<string, { asset: string; bytes: number; sha256: string }> = {
  'darwin-arm64': {
    asset: `llama-${LLAMA_TAG}-bin-macos-arm64.tar.gz`,
    bytes: 12_116_133,
    sha256: 'a9c10e58e42603d67a3ad3cbe991d420e31d350937e11775db55011e25536668',
  },
  'darwin-x64': {
    asset: `llama-${LLAMA_TAG}-bin-macos-x64.tar.gz`,
    bytes: 11_614_051,
    sha256: 'f98d8f17e2bb39027f783cb7750eb498f39da4243c6a29827634568db9f0aa2d',
  },
  'linux-x64': {
    asset: `llama-${LLAMA_TAG}-bin-ubuntu-x64.tar.gz`,
    bytes: 17_733_967,
    sha256: 'a5ce0dfd864e2acad5922e0d508fe56aaa18298e79327f511efa93b16dcbfbcc',
  },
  'linux-arm64': {
    asset: `llama-${LLAMA_TAG}-bin-ubuntu-arm64.tar.gz`,
    bytes: 13_841_462,
    sha256: '6ee061b602526d185316ffc16c450f7ed4613aaedbb6224493bf3507c8444287',
  },
  'win32-x64': {
    asset: `llama-${LLAMA_TAG}-bin-win-cpu-x64.zip`,
    bytes: 19_514_527,
    sha256: 'ea688fd5cd702f0f1a3703d1b5ba098a9aea21a87221c8d7b2c50245e3beabdf',
  },
  'win32-arm64': {
    asset: `llama-${LLAMA_TAG}-bin-win-cpu-arm64.zip`,
    bytes: 12_382_421,
    sha256: '36b197ed17c2a9267cc9e02372812103d7e8465b56b5f879729c84fbff554157',
  },
}

/** The pinned runtime for this host, or null where llama.cpp publishes no build. */
export function runtimeBuildFor(
  platform: string = process.platform,
  arch: string = process.arch,
): RuntimeBuild | null {
  const build = LLAMA_BUILDS[`${platform}-${arch}`]
  if (!build) return null
  const windows = platform === 'win32'
  return {
    tag: LLAMA_TAG,
    archive: {
      name: build.asset,
      url: `${LLAMA_RELEASE}/${build.asset}`,
      bytes: build.bytes,
      sha256: build.sha256,
      format: windows ? 'zip' : 'tar.gz',
    },
    executable: windows ? 'llama-server.exe' : 'llama-server',
  }
}
