/**
 * Resolve a provider URI's segments to the repository it names, or to the
 * repo-choosing level of a multi-root container.
 */
import type { GitRepoEntry, ResourceGitService } from '../resource-provider'
import { CONTAINER_REPO_SEGMENT, repoNodeSegments, repoRootSegments, type RepoBase } from './uris'

/** A concrete repo resolved from a URI: its git cwd + the URI prefix that
 *  identifies it + the section segments below it. */
export interface RepoTarget {
  kind: 'repo'
  pid: string
  base: RepoBase
  cwd: string
  rest: string[]
}
/** The repo-CHOOSING level of a multi-root container (or the `/repos` folder). */
export interface PickerTarget {
  kind: 'picker'
  pid: string
  repos: GitRepoEntry[]
}

/**
 * Resolve a URI's segments to either a concrete repo (`cwd` + `base` prefix +
 * the section `rest`) or the repo picker of a multi-root container. Returns null
 * when the project is unknown / not a git area, or a nested `relpath` isn't among
 * the discovered repos (the guard against a crafted `..` path). A plain single
 * repo maps the bare `<pid>` straight to its sections (no picker level).
 */
export async function resolveTarget(
  service: ResourceGitService,
  userId: string,
  segments: string[],
): Promise<RepoTarget | PickerTarget | null> {
  const pid = segments[0]
  if (!pid) return null
  const containerCwd = await service.resolveRepoCwd(userId, pid)
  if (!containerCwd) return null

  const nested = segments[1] === 'repos'
  const encRel = nested ? segments[2] : undefined

  // The repo-CHOOSING level: the bare `<pid>` (root) or the explicit `/repos` folder.
  if ((!nested && segments.length === 1) || (nested && encRel === undefined)) {
    const repos = await service.listRepos(containerCwd)
    if (repos.length === 0) return null
    // A single plain repo (container IS the repo) → skip the picker; the bare `<pid>`
    // maps straight to its sections.
    if (!nested && repos.length === 1 && repos[0].relpath === '') {
      return { kind: 'repo', pid, base: repoRootSegments(pid), cwd: repos[0].cwd, rest: [] }
    }
    return { kind: 'picker', pid, repos }
  }

  if (nested) {
    const relpath = encRel === CONTAINER_REPO_SEGMENT ? '' : encRel!
    const entry = (await service.listRepos(containerCwd)).find((r) => r.relpath === relpath)
    if (!entry) return null // crafted / unknown nested path — refuse
    return {
      kind: 'repo',
      pid,
      base: repoNodeSegments(pid, relpath),
      cwd: entry.cwd,
      rest: segments.slice(3),
    }
  }

  // Single-repo direct sections: `<pid>/branches…`. Resolve the repo cwd
  // (the container repo, else the first discovered).
  const repos = await service.listRepos(containerCwd)
  const primary = repos.find((r) => r.relpath === '') ?? repos[0]
  if (!primary) return null
  return {
    kind: 'repo',
    pid,
    base: repoRootSegments(pid),
    cwd: primary.cwd,
    rest: segments.slice(1),
  }
}
