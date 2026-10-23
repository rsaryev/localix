/**
 * GIT resource provider — a `ResourceRefProvider` (agent-core resource-refs)
 * owning the `git` resource provider, the sibling of the database provider. It turns the
 * user's git PROJECTS into a referenceable tree the composer `@`-menu drills
 * (repo → branches / commits → files + working scopes) and resolves a node to
 * model-facing text (a branch's vs-base diff, a commit patch, a per-file diff, the
 * working / staged / unstaged diff). These nodes are the `/review` target set.
 *
 * URI grammar (positional; `<projectId>` re-resolves the working dir at every
 * level, since a provider is keyed by (userId, parentUri) with NO session). A
 * project may be a SINGLE repo, or a MULTI-ROOT container holding several repos —
 * a `repos/<relpath>` level selects one when there is more than one:
 *   <resource>/<projectId>                           → a repo (single) OR a repo picker (multi-root)
 *   <resource>/<projectId>/repos/<relpath>           → one nested repo (relpath url-encoded; '~' = the container repo)
 *   <repo>/branches                                  → the branches folder
 *   <repo>/branches/<branch…>                        → a branch (leaf; expands to its vs-base diff; may contain `/`)
 *   <repo>/commits                                   → the commits folder
 *   <repo>/commits/<sha>                             → a commit (folder → its files; expand = full patch)
 *   <repo>/commits/<sha>/<path…>                     → a file within a commit (leaf; path may contain `/`)
 *   <repo>/status | /staged | /unstaged             → the working / staged / unstaged diff (leaves)
 * where `<resource>` is `localix://resource/git` and `<repo>` is `<resource>/<projectId>`
 * (single) or `<resource>/<projectId>/repos/<relpath>` (nested).
 *
 * The impedance mismatch: `ResourceRefProvider` has no session, but the git
 * backend is cwd-keyed. So this consumes a narrow cwd-keyed `ResourceGitService`
 * port (implemented at bootstrap by composing `projectsService` + the git backend
 * + repo discovery) rather than the session-keyed `SourceControlService`.
 *
 * The repo's on-disk PATH is intentionally included in each expansion so the agent
 * (e.g. a `/review`) can run git / read files in exactly the right repo — essential
 * for a nested repo, whose path differs from the session's workspace root. This is
 * not a leak: the workspace root is already in the system prompt, and a nested path
 * is a subdir of it the agent could `ls`.
 *
 * SECURITY: it works from porcelain introspection only — branch names, commit
 * metadata, diffs, and the local repo path. It NEVER surfaces a remote URL or
 * `.git/config` secret; the `upstream` it shows is a ref short name (e.g.
 * `origin/main`), not a URL. A nested repo's cwd is taken from DISCOVERY (never
 * from the URL path), so a crafted `..` relpath can't escape the container. An
 * expansion reaches the model wire, so these boundaries are load-bearing.
 */
import type { FileDiff, RepoBranch, RepoCommit, RepoStatus } from './contracts'
import type { ScopeDiff } from './git/scope-diff'
import type { ResourceRefProvider } from '@localixai/mini-app-sdk/backend'
import { buildResourceUri, linkAction } from '@localixai/mini-app-sdk/backend'
import { decodedSegments, repoRootSegments, SCHEME } from './resource/uris'
import { resolveTarget } from './resource/target'
import {
  branchNodes,
  commitFileNodes,
  commitNodes,
  repoNodes,
  repoSectionNodes,
} from './resource/nodes'
import { expandPicker, expandRepo } from './resource/expand'

/** A project that resolved to a git repository / container (a provider root). */
export interface GitRepoProject {
  id: string
  name: string
  /** Absolute working directory — used only server-side, never surfaced. */
  cwd: string
  /** Current branch (or null when detached / unborn / a container) for the detail line. */
  branch: string | null
}

/** One git repo discovered under a project container. */
export interface GitRepoEntry {
  /** Repo root relative to the container; '' when the container ITSELF is the repo. */
  relpath: string
  /** Display label — the repo's directory name (the container repo shows as 'root'). */
  name: string
  /** Absolute repo working dir, from DISCOVERY (never URL-derived) — safe to run git in. */
  cwd: string
}

/**
 * Narrow cwd-keyed port over the git backend + projects registry — the only
 * reads this provider needs, so it's trivially testable with a fake. Implemented
 * at bootstrap by composing `projectsService` (projectId→cwd, repo/container
 * filter) with a single `createGitBackend()` instance + repo discovery.
 */
export interface ResourceGitService {
  /** The user's projects that are (or contain) git repos — the provider roots. */
  listRepoProjects(userId: string): Promise<GitRepoProject[]>
  /** Resolve a projectId → the project's container working dir; null when unknown. */
  resolveRepoCwd(userId: string, projectId: string): Promise<string | null>
  /** Git repos under the container (one entry with relpath '' for a plain single
   *  repo; several for a multi-root container). Empty when the dir holds no repo. */
  listRepos(containerCwd: string): Promise<GitRepoEntry[]>
  listBranches(cwd: string): Promise<RepoBranch[]>
  getStatus(cwd: string): Promise<RepoStatus>
  getLog(cwd: string, limit: number): Promise<RepoCommit[]>
  getCommitShow(cwd: string, sha: string): Promise<FileDiff>
  getCommitFiles(cwd: string, sha: string): Promise<string[]>
  getCommitFileDiff(cwd: string, sha: string, path: string): Promise<string>
  getWorkingDiff(cwd: string): Promise<{ diff: string; stat: string; staged: boolean }>
  /** The STAGED set (`git diff --cached`) — empty diff when nothing staged. */
  getStagedDiff(cwd: string): Promise<ScopeDiff>
  /** The UNSTAGED set (`git diff`, tracked files) — empty when nothing to show. */
  getUnstagedDiff(cwd: string): Promise<ScopeDiff>
  /** A branch vs its base (`git diff <base>...<branch>`); null when no base resolves. */
  getBranchDiff(cwd: string, branch: string): Promise<(ScopeDiff & { base: string }) | null>
}

export function createGitResourceProvider(service: ResourceGitService): ResourceRefProvider {
  return {
    // `provider`, not `scheme`: that is the field `ResourceRefProvider` declares, and it is what
    // `createResourceContextProvider` reads to derive the context provider's own id. Spelled
    // `scheme` it was simply absent, so the git context provider threw on construction.
    provider: SCHEME,
    title: 'Repositories',

    async listChildren(userId, parentUri, query) {
      if (parentUri === null) {
        const projects = await service.listRepoProjects(userId)
        return projects.map((p) => ({
          uri: buildResourceUri(SCHEME, repoRootSegments(p.id)),
          label: p.name,
          detail: p.branch ?? undefined,
          hasChildren: true,
          icon: 'repo',
          actions: linkAction('Link this repository'),
        }))
      }
      const segments = decodedSegments(parentUri)
      if (!segments) return []
      const target = await resolveTarget(service, userId, segments)
      if (!target) return []
      if (target.kind === 'picker') return repoNodes(target.pid, target.repos)

      const { base, cwd, rest } = target
      // <repo> — the repo's sections.
      if (rest.length === 0) return repoSectionNodes(base)
      const [section, sha] = rest
      // <repo>/branches — the branch list (branch leaves).
      if (section === 'branches' && rest.length === 1) return branchNodes(service, base, cwd)
      // <repo>/commits — the recent commits (commit folders; query searches deeper).
      if (section === 'commits' && rest.length === 1) return commitNodes(service, base, cwd, query)
      // <repo>/commits/<sha> — the files that commit touched (file leaves).
      if (section === 'commits' && rest.length === 2 && sha)
        return commitFileNodes(service, base, cwd, sha)
      return []
    },

    async expand(userId, uri) {
      const segments = decodedSegments(uri)
      if (!segments) return { ok: false, error: 'not a git resource' }
      const target = await resolveTarget(service, userId, segments)
      if (!target) return { ok: false, error: 'unresolvable git uri' }
      return target.kind === 'picker' ? expandPicker(target) : expandRepo(service, target)
    },
  }
}
