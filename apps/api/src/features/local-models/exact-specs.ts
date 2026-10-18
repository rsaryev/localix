/**
 * The exact files of a repository — sizes, LFS hashes, its drafter — read only when a model is
 * shown in detail or installed, and kept for good per commit: files at a commit never change,
 * so a copy at the listing's current commit is current however old. Without a commit to check
 * (resolving an id), any stored copy serves; a new read happens when the commit moves.
 */
import path from 'node:path'
import type { LocalModelSpec } from './contracts'
import type { DrafterFinder } from './drafters'
import { labelOf, specsFromRepo } from './hf-catalog'
import type { HfClient, HfRepoInfo } from './hf-client'
import { createJsonFile } from './json-file'

const VERSION = 1

export interface ExactRepo {
  revision: string
  specs: LocalModelSpec[]
}

export function createExactSpecs(deps: {
  root: string
  hf: HfClient
  drafters: () => DrafterFinder
  log?: (event: string, fields: Record<string, unknown>) => void
}) {
  const file = createJsonFile<Record<string, ExactRepo>>(
    path.join(deps.root, 'exact-specs.json'),
    VERSION,
  )
  const repos = new Map<string, ExactRepo>()
  const inFlight = new Map<string, Promise<ExactRepo | null>>()
  let restored: Promise<void> | null = null

  const restore = () =>
    (restored ??= file.read().then((data) => {
      // The name is presentation, not a fact of the files: named afresh, never from the copy.
      for (const [repo, exact] of Object.entries(data ?? {})) {
        repos.set(repo, {
          ...exact,
          specs: exact.specs.map((s) => ({ ...s, label: labelOf(repo) })),
        })
      }
    }))

  async function read(repo: string): Promise<ExactRepo> {
    const info = await deps.hf.repo(repo)
    const specs = specsFromRepo(info)
    const drafter = specs.some((s) => s.kind === 'chat')
      ? await deps
          .drafters()
          .forTarget(repo)
          .catch(() => null)
      : null
    return {
      revision: info.sha,
      specs: drafter
        ? specs.map((s) => ({
            ...s,
            files: [...s.files, drafter.file],
            bytes: s.bytes + drafter.file.bytes,
            draft: { method: drafter.method, repo: drafter.repo },
          }))
        : specs,
    }
  }

  return {
    restore,

    /** Exact specs at `revision` (or any stored ones without it); read when missing or moved. */
    async get(repo: string, revision?: string): Promise<ExactRepo | null> {
      await restore()
      const stored = repos.get(repo)
      if (stored && (!revision || stored.revision === revision)) return stored
      const running = inFlight.get(repo)
      if (running) return running
      const job = read(repo)
        .then((exact) => {
          repos.set(repo, exact)
          file.save(() => Object.fromEntries(repos))
          return exact
        })
        .catch((err: unknown) => {
          deps.log?.('local_models.repo_unreachable', { repo, error: String(err) })
          return stored ?? null
        })
        .finally(() => inFlight.delete(repo))
      inFlight.set(repo, job)
      return job
    },

    /** Stored exact specs, without asking (a card shows exact sizes once they are known). */
    peek: (repo: string, revision?: string): ExactRepo | undefined => {
      const stored = repos.get(repo)
      return stored && (!revision || stored.revision === revision) ? stored : undefined
    },

    /** Raw repository metadata: what drafters are resolved from. */
    info: (repo: string): Promise<HfRepoInfo | null> => deps.hf.repo(repo).catch(() => null),

    /** Test seam: store one repository's exact specs. */
    seed(info: HfRepoInfo) {
      repos.set(info.id, { revision: info.sha, specs: specsFromRepo(info) })
    },

    flush: () => file.flush(),
  }
}

export type ExactSpecs = ReturnType<typeof createExactSpecs>
