/**
 * Repo-workspace service — the multi-root layer over the single-repo source
 * control. It discovers every git repository under a session's working dir
 * (a container that may hold many sibling repos), resolves a scoped `repoRoot`
 * to a validated cwd, and reports each repo's status for the grouped Changes
 * tree. Kept separate from `SourceControlService` so that stays free of
 * filesystem-scan concerns; wired together in bootstrap.
 */
import path from 'node:path'
import { mapLimit } from '../support/map-limit'
import type { SourceControlBackend } from '../ports'
import type { RepoWithStatus, SourceControlStatus } from '../contracts'
import { discoverRepos, type DiscoverOptions } from './discovery'

export interface RepoWorkspaceDeps {
  /** The session's base working dir — the container to scan (worktree/project/sandbox). */
  resolveScanRoot: (userId: string, sessionId: string | null) => Promise<string | null>
  /** The VCS backend used to read each repo's status. */
  backend: SourceControlBackend
  /** Discovery options (depth/cap/skip); mainly for tests. */
  discoverOptions?: DiscoverOptions
  /** How long a discovered repo set stays cached per scan root (ms). Default 20s. */
  cacheTtlMs?: number
  /** Max concurrent status reads across repos. Default 8. */
  statusConcurrency?: number
}

export interface RepoWorkspaceService {
  /** Every repo discovered for the session, each with its full status. */
  listRepoStatuses(userId: string, sessionId: string | null): Promise<RepoWithStatus[]>
  /**
   * Resolve the cwd a scoped op runs in. `repoRoot` must be one of the session's
   * discovered repos. An explicit unknown/forged/stale root fails closed; it must
   * never silently retarget a commit, diff, or model context to the primary repo.
   * With no explicit scope, the base scan root preserves single-repo behaviour.
   */
  resolveRepoCwd(
    userId: string,
    sessionId: string | null,
    repoRoot?: string,
  ): Promise<string | null>
}

/** Canonical comparison key for a repo path (absolute, no trailing sep). */
const norm = (p: string): string => path.resolve(p)

export function createRepoWorkspaceService(deps: RepoWorkspaceDeps): RepoWorkspaceService {
  // 20s, deliberately LONGER than the panel's fastest poll (6s during a run).
  // At 5s the cache expired just before every tick, so the bounded directory walk
  // ran on each one and the cache never once returned a hit — it cost bookkeeping
  // and saved nothing. Repos are created and removed on a human timescale, so a
  // window measured in seconds is the right freshness for a filesystem SCAN;
  // each repo's STATUS is re-read every tick regardless.
  const ttl = deps.cacheTtlMs ?? 20_000
  const concurrency = deps.statusConcurrency ?? 8
  // Per-scan-root cache of discovered repo roots (short TTL — repos come and go rarely).
  const cache = new Map<string, { at: number; roots: string[] }>()

  async function discoverFor(scanRoot: string): Promise<string[]> {
    const hit = cache.get(scanRoot)
    if (hit && Date.now() - hit.at < ttl) return hit.roots
    const roots = await discoverRepos(scanRoot, deps.discoverOptions ?? {})
    cache.set(scanRoot, { at: Date.now(), roots })
    return roots
  }

  const displayName = (scanRoot: string, root: string): string => {
    const rel = path.relative(scanRoot, root)
    return rel === '' ? path.basename(root) : rel
  }

  return {
    async listRepoStatuses(userId, sessionId) {
      const scanRoot = await deps.resolveScanRoot(userId, sessionId)
      if (!scanRoot) return []
      const roots = await discoverFor(scanRoot)
      if (roots.length === 0) return []
      const scanKey = norm(scanRoot)
      const rows = await mapLimit(
        roots,
        concurrency,
        async (root): Promise<RepoWithStatus | null> => {
          const raw = await deps.backend.getStatus(root).catch(() => null)
          if (!raw) return null
          const status: SourceControlStatus = { isRepo: true, vcs: deps.backend.id, ...raw }
          return {
            root,
            name: displayName(scanRoot, root),
            isPrimary: norm(root) === scanKey,
            status,
          }
        },
      )
      return rows.filter((r): r is RepoWithStatus => r !== null)
    },

    async resolveRepoCwd(userId, sessionId, repoRoot) {
      const scanRoot = await deps.resolveScanRoot(userId, sessionId)
      if (!scanRoot) return null
      if (!repoRoot) return scanRoot
      const roots = await discoverFor(scanRoot)
      const target = norm(repoRoot)
      return roots.some((r) => norm(r) === target) ? repoRoot : null
    },
  }
}
