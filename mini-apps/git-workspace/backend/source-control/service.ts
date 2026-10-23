/**
 * Source-control orchestration. VCS-agnostic: it resolves a session's working
 * directory, asks the backend resolver which backend owns it, and delegates.
 * When no backend claims the directory (not a repo, or unresolved cwd) reads
 * return an empty/"not a repo" envelope and writes 404 — callers never see a
 * throw for the common "this project isn't a repo" case.
 *
 * Multi-root: every method takes an optional trailing `repoRoot` naming which
 * repository of a multi-repo project the op targets. It threads to
 * `deps.resolveCwd`, which validates it against the session's discovered repos
 * and falls back to the primary repo when absent/unknown. Omitting it preserves
 * the single-repo behaviour exactly.
 */
import { defaultGitInstalled } from './git-prerequisite'
import type { RepoWithStatus } from './contracts'
import type { ResolveBackend, ResolveCwd } from './ports'
import { createRepoAccess } from './ops/repo-access'
import { createSourceControlReads } from './ops/reads'
import { createSourceControlTreeWrites } from './ops/tree-writes'
import { createSourceControlRefWrites } from './ops/ref-writes'

/**
 * Optional: resolve the session metadata recorded in a commit's provenance note
 * (model + agent mode). Kept as an injected callback so the service stays
 * VCS-neutral and never imports chat internals. Null/absent → the note still
 * carries `{ sessionId, createdAt }`, just without the richer fields.
 */
export type ResolveCommitNoteMeta = (input: {
  userId: string
  sessionId: string
}) => Promise<{ model?: string; rationale?: string } | null>

/**
 * Optional: list every repository discovered for a session (multi-root), each
 * with its full status. Injected (from the repo-workspace service) so this
 * service stays free of filesystem-scan concerns. Absent → single-repo only.
 */
export type ListRepoStatuses = (
  userId: string,
  sessionId: string | null,
) => Promise<RepoWithStatus[]>

export interface SourceControlServiceDeps {
  resolveCwd: ResolveCwd
  resolveBackend: ResolveBackend
  /** Optional: enrich the commit provenance note with the session's model. */
  resolveCommitNoteMeta?: ResolveCommitNoteMeta
  /** Optional: enumerate the session's repos with status (multi-root view). */
  listRepoStatuses?: ListRepoStatuses
  /** Is `git` on this machine — "no repository" may mean it is not (`git-prerequisite.ts`). */
  gitInstalled?: () => boolean
}

/**
 * The service's own contract lives beside this file — ~370 lines of signatures
 * that describe the port, not the machinery. Imported for the factory's return
 * type and re-exported so every importer still reads `from './service'`.
 */
import type { SourceControlService } from './service-contract'
export type { SourceControlService }

/**
 * Composes the operation groups over one shared repo access (backend memo and
 * write serializer), so reads and every write group see the same per-repo state.
 */
export function createSourceControlService(deps: SourceControlServiceDeps): SourceControlService {
  const access = createRepoAccess(deps)
  return {
    ...createSourceControlReads(access, {
      resolveCwd: deps.resolveCwd,
      listRepoStatuses: deps.listRepoStatuses,
      gitInstalled: deps.gitInstalled ?? defaultGitInstalled,
    }),
    ...createSourceControlTreeWrites(access),
    ...createSourceControlRefWrites(access, { resolveCommitNoteMeta: deps.resolveCommitNoteMeta }),
  }
}
