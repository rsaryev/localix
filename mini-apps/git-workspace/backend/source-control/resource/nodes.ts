/** The `@`-menu nodes of one repository: its sections, branches, commits and commit files. */
import type { ResourceNode } from '@localixai/mini-app-sdk/backend'
import { buildResourceUri, linkAction, truncationNotice } from '@localixai/mini-app-sdk/backend'
import type { GitRepoEntry, ResourceGitService } from '../resource-provider'
import {
  branchDetail,
  branchesUri,
  branchUri,
  COMMIT_LIMIT,
  COMMIT_SEARCH_DEPTH,
  commitFileUri,
  commitsUri,
  commitUri,
  repoNodeSegments,
  SCHEME,
  stagedUri,
  statusUri,
  unstagedUri,
  type RepoBase,
} from './uris'

/** Branch/commit folders + working-tree scope leaves of a repo. Each scope
 *  (working status / staged / unstaged) is a reviewable leaf that expands to its
 *  diff — the full hierarchy a `/review` target drills. `base` is the repo's URI. */
export function repoSectionNodes(base: RepoBase): ResourceNode[] {
  return [
    { uri: branchesUri(base), label: 'Branches', hasChildren: true, icon: 'git-branch' },
    { uri: commitsUri(base), label: 'Commits', hasChildren: true, icon: 'history' },
    {
      uri: statusUri(base),
      label: 'Working status',
      detail: 'all uncommitted changes',
      hasChildren: false,
      icon: 'file-diff',
    },
    {
      uri: stagedUri(base),
      label: 'Staged',
      detail: 'staged changes only',
      hasChildren: false,
      icon: 'file-diff',
    },
    {
      uri: unstagedUri(base),
      label: 'Unstaged',
      detail: 'unstaged changes only',
      hasChildren: false,
      icon: 'file-diff',
    },
  ]
}

/** The repo picker for a multi-root container. */
export function repoNodes(pid: string, repos: GitRepoEntry[]): ResourceNode[] {
  return repos.map((r) => ({
    uri: buildResourceUri(SCHEME, repoNodeSegments(pid, r.relpath)),
    label: r.name,
    detail: r.relpath || undefined,
    hasChildren: true,
    icon: 'repo',
  }))
}

export async function branchNodes(
  service: ResourceGitService,
  base: RepoBase,
  cwd: string,
): Promise<ResourceNode[]> {
  const [branches, status] = await Promise.all([
    service.listBranches(cwd),
    service.getStatus(cwd).catch(() => null),
  ])
  return branches.map((b) => ({
    uri: branchUri(base, b.name),
    label: b.name,
    detail: branchDetail(b, status) || undefined,
    hasChildren: false,
    icon: 'git-branch',
  }))
}

export async function commitNodes(
  service: ResourceGitService,
  base: RepoBase,
  cwd: string,
  query?: string,
): Promise<ResourceNode[]> {
  // The listing is CAPPED — honour the typed query BEFORE the cap (search a
  // deeper window, filter by sha prefix / subject, then page) per the registry
  // contract, else commits past the first 50 are unreachable by typing.
  const q = query?.trim().toLowerCase()
  const log = await service.getLog(cwd, q ? COMMIT_SEARCH_DEPTH : COMMIT_LIMIT)
  const matched = q
    ? log.filter(
        (c) =>
          c.subject.toLowerCase().includes(q) ||
          c.shortHash.toLowerCase().startsWith(q) ||
          c.hash.toLowerCase().startsWith(q),
      )
    : log
  const commits = matched.slice(0, COMMIT_LIMIT)
  const nodes: ResourceNode[] = commits.map((c) => ({
    uri: commitUri(base, c.shortHash),
    label: c.subject || c.shortHash,
    detail: [c.shortHash, c.author, c.relativeDate].filter(Boolean).join(' · '),
    hasChildren: true,
    icon: 'git-commit',
    // A commit is a CONTAINER (its files drill below) but is itself the primary
    // review target — declare an explicit link so the composer surfaces "Link this
    // commit" at the top of the file level, not only the hidden `→` gesture.
    actions: linkAction('Link this commit'),
  }))
  // Say when the page dropped commits — in-band, as a non-interactive notice row.
  if (matched.length > commits.length) {
    nodes.push(truncationNotice(commitsUri(base), commits.length, matched.length, 'commits', q))
  }
  return nodes
}

export async function commitFileNodes(
  service: ResourceGitService,
  base: RepoBase,
  cwd: string,
  sha: string,
): Promise<ResourceNode[]> {
  const files = await service.getCommitFiles(cwd, sha)
  return files.map((path) => {
    const slash = path.lastIndexOf('/')
    return {
      uri: commitFileUri(base, sha, path),
      label: slash >= 0 ? path.slice(slash + 1) : path,
      detail: slash >= 0 ? path.slice(0, slash) : undefined,
      hasChildren: false,
      icon: 'file',
    }
  })
}
