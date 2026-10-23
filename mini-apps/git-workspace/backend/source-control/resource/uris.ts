/**
 * The git provider's address space and shared presentation helpers: the URI
 * builders, segment decoding, listing limits, and one-line detail formatting.
 */
import type { RepoBranch, RepoStatus } from '../contracts'
import type { ScopeDiff } from '../git/scope-diff'
import { buildResourceUri, providerSegments } from '@localixai/mini-app-sdk/backend'

/** Provider-owned URI scheme. Core dispatches resource schemes as open strings. */
export const SCHEME = 'git'

/**
 * The container repo's slot in `…/repos/<relpath>`.
 *
 * It was `.`, which the canonical builder rejects outright (`localixUri` refuses `''`, `'.'` and
 * `'..'` as identity segments — they are path traversal, not identity). Any replacement is a
 * reserved word in the relpath space, so this one is chosen to be unproduceable by `path.relative`
 * for a real nested repository. Even if a directory literally named `~` existed, `resolveTarget`
 * validates every decoded relpath against the DISCOVERED repo list, so the worst case is that one
 * pathological directory is unaddressable — never a wrong repo resolved.
 */
export const CONTAINER_REPO_SEGMENT = '~'

export const NO_SCOPE: ScopeDiff = { diff: '', truncated: false }

/** Says an overflowed scope shows only its leading files, so a cut list never reads as whole. */
export function truncatedNote(scope: { truncated?: boolean }): string {
  return scope.truncated ? ' (too large to show in full — leading files only)' : ''
}

/** How many commits the `commits` folder lists. */
export const COMMIT_LIMIT = 50
/** How deep a typed query searches the log (filter FIRST, then cap at
 *  COMMIT_LIMIT) — so a sha / subject the 50-commit page dropped is reachable. */
export const COMMIT_SEARCH_DEPTH = 500

/**
 * Every URI is built from SEGMENTS through the shared builder, never concatenated.
 *
 * The provider used to hand-write a retired `git:` scheme while parsing with the canonical
 * `providerSegments`, so it emitted an address space the parser could not read: every
 * `listChildren` on a self-produced URI resolved to `null` and returned `[]`. That scheme is also
 * retired — the address space is `localix://resource/git/…` — which `check-architecture` flags
 * on sight.
 *
 * A base is carried as its segment ARRAY rather than a string prefix, because the builder
 * percent-encodes per segment: appending `/${branch}` to a built string would double-encode the
 * safe characters and leave a slash-bearing branch name split by a separator nobody escaped.
 * Splitting on `/` here keeps the existing grammar exactly — a branch or file path spans several
 * segments, which is how `expand` reassembles it with `rest.slice(1).join('/')`.
 */
export type RepoBase = readonly string[]

export const repoRootSegments = (pid: string): RepoBase => [pid]
export const repoNodeSegments = (pid: string, relpath: string): RepoBase => [
  pid,
  'repos',
  relpath || CONTAINER_REPO_SEGMENT,
]
/**
 * The provider's segments, percent-decoding each one.
 *
 * `providerSegments` hands back the RAW segments — `parseLocalixResourceUri` deliberately leaves
 * decoding to the caller, as the docker anchor does too. The builder encodes per segment, so
 * without this a nested repo addressed as `repos/nested%2Fsvc-b` never matched the discovered
 * relpath `nested/svc-b` and the node resolved to nothing. Decoding here (rather than at each of
 * the six read sites) keeps every downstream join — a branch name, a commit file path — working on
 * plain text exactly as it did before the address space moved.
 */
export const decodedSegments = (uri: string): string[] | null =>
  providerSegments(SCHEME, uri)?.map((segment) => decodeURIComponent(segment)) ?? null

export const uriOf = (base: RepoBase, ...rest: string[]) =>
  buildResourceUri(SCHEME, [...base, ...rest])
export const branchesUri = (base: RepoBase) => uriOf(base, 'branches')
export const commitsUri = (base: RepoBase) => uriOf(base, 'commits')
export const statusUri = (base: RepoBase) => uriOf(base, 'status')
export const stagedUri = (base: RepoBase) => uriOf(base, 'staged')
export const unstagedUri = (base: RepoBase) => uriOf(base, 'unstaged')
export const branchUri = (base: RepoBase, branch: string) =>
  uriOf(base, 'branches', ...branch.split('/'))
export const commitUri = (base: RepoBase, sha: string) => uriOf(base, 'commits', sha)
export const commitFileUri = (base: RepoBase, sha: string, path: string) =>
  uriOf(base, 'commits', sha, ...path.split('/'))

/** Compact one-line ahead/behind + upstream summary for a branch detail. */
export function branchDetail(branch: RepoBranch, status: RepoStatus | null): string {
  const parts: string[] = []
  if (branch.current) parts.push('current')
  if (branch.upstream) parts.push(`↑${branch.upstream}`)
  if (branch.current && status && (status.ahead > 0 || status.behind > 0)) {
    parts.push(`ahead ${status.ahead} · behind ${status.behind}`)
  }
  if (branch.updatedAt) parts.push(branch.updatedAt)
  return parts.join(' · ')
}
