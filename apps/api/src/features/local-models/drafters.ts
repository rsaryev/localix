/**
 * Draft models for speculative decoding: a small model proposes the next few tokens and the main
 * one checks them all in one step, so replies come faster with exactly the same text.
 *
 * Drafters are found by name, not listed by hand: a publisher of drafters names each after its
 * target (`gemma-4-E2B-it-qat-MTP-GGUF` drafts for `gemma-4-E2B-it`), so a target repository is
 * matched to the drafter whose name, less its method and build qualifiers, is the target's own.
 * Only methods verified end to end with the pinned llama.cpp are attached ({@link VERIFIED}).
 * Measured on an M5: Gemma 4 E2B with its MTP drafter decodes 1.7–2.2× faster (58 → 100–127
 * tokens/s), images included.
 */
import type { DraftMethod, LocalModelFile } from './contracts'
import { HF_BASE, type HfClient, type HfRepoInfo } from './hf-client'

export const DRAFT_PUBLISHER = 'magnitudedev'

/** Methods whose drafters load and speed up with the pinned runtime (checked, not assumed). */
const VERIFIED: ReadonlySet<DraftMethod> = new Set(['mtp'])

const METHOD: Record<string, DraftMethod> = { mtp: 'mtp', dflash: 'dflash', dspark: 'dspark' }
/** Build qualifiers that do not change which model a drafter serves. */
const QUALIFIERS = /-(qat|nvfp4|q4_0|q8_0)(?=-|$)/gi

/** `ggml-org/gemma-4-E2B-it-GGUF` → `gemma-4-e2b-it`: the name drafters are matched on. */
export function targetKey(repo: string): string {
  return (repo.split('/').pop() ?? repo)
    .replace(/-GGUF$/i, '')
    .replace(QUALIFIERS, '')
    .toLowerCase()
}

/** `magnitudedev/gemma-4-E2B-it-qat-MTP-GGUF` → its target key and method, or null. */
export function parseDrafterRepo(repo: string): { key: string; method: DraftMethod } | null {
  const name = (repo.split('/').pop() ?? repo).replace(/-GGUF$/i, '')
  const m = /^(.*)-(MTP|DFlash|DSpark)$/i.exec(name)
  if (!m) return null
  const method = METHOD[m[2]!.toLowerCase()]
  return method ? { key: targetKey(m[1]!), method } : null
}

export interface Drafter {
  method: DraftMethod
  repo: string
  file: LocalModelFile
}

/** The drafter's one weights file, pinned to the repository's commit like any model file. */
export function drafterFile(info: HfRepoInfo): LocalModelFile | null {
  const ggufs = (info.siblings ?? []).filter(
    (f) => f.rfilename.endsWith('.gguf') && f.size && f.lfs?.sha256,
  )
  const pick =
    ggufs.find((f) => /Q8_0\.gguf$/i.test(f.rfilename)) ??
    [...ggufs].sort((a, b) => (a.size ?? 0) - (b.size ?? 0))[0]
  if (!pick) return null
  return {
    name: pick.rfilename,
    url: `${HF_BASE}/${info.id}/resolve/${info.sha}/${pick.rfilename}`,
    bytes: pick.size!,
    sha256: pick.lfs!.sha256!,
    role: 'draft',
  }
}

const LIST_TTL_MS = 24 * 60 * 60_000

/** Finds the verified drafter for a target repository; one listing a day, one lookup per match. */
export function createDrafterFinder(deps: {
  hf: HfClient
  repo: (repo: string) => Promise<HfRepoInfo | null>
  now?: () => number
}) {
  const clock = deps.now ?? Date.now
  let listing: { at: number; byKey: Map<string, { repo: string; method: DraftMethod }> } | null =
    null

  async function byKey() {
    if (listing && clock() - listing.at < LIST_TTL_MS) return listing.byKey
    try {
      const rows = await deps.hf.models({ author: DRAFT_PUBLISHER, limit: 200 })
      const map = new Map<string, { repo: string; method: DraftMethod }>()
      for (const row of rows) {
        const parsed = parseDrafterRepo(row.id)
        if (parsed && VERIFIED.has(parsed.method) && !map.has(parsed.key)) {
          map.set(parsed.key, { repo: row.id, method: parsed.method })
        }
      }
      listing = { at: clock(), byKey: map }
    } catch {
      // Offline: no drafters this time; models still run, only without the speed-up.
      return listing?.byKey ?? new Map()
    }
    return listing.byKey
  }

  return {
    /**
     * Which targets have a verified drafter, from the day's listing alone (no files): what a
     * catalog card says before its repository is read.
     */
    async lookup(): Promise<(targetRepo: string) => { method: DraftMethod; repo: string } | null> {
      const map = await byKey()
      return (targetRepo) => map.get(targetKey(targetRepo)) ?? null
    },

    async forTarget(targetRepo: string): Promise<Drafter | null> {
      const match = (await byKey()).get(targetKey(targetRepo))
      if (!match) return null
      const info = await deps.repo(match.repo)
      const file = info ? drafterFile(info) : null
      return file ? { method: match.method, repo: match.repo, file } : null
    },
  }
}

export type DrafterFinder = ReturnType<typeof createDrafterFinder>
