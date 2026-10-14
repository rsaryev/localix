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
import type {
  ResourceExpansion,
  ResourceNode,
  ResourceRefProvider,
} from '@localixai/plugin-sdk/backend'
import {
  buildResourceUri,
  linkAction,
  plural,
  providerSegments,
  truncationNotice,
} from '@localixai/plugin-sdk/backend'

/** Provider-owned URI scheme. Core dispatches resource schemes as open strings. */
const SCHEME = 'git'

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
const CONTAINER_REPO_SEGMENT = '~'

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

const NO_SCOPE: ScopeDiff = { diff: '', truncated: false }

/** Says an overflowed scope shows only its leading files, so a cut list never reads as whole. */
function truncatedNote(scope: { truncated?: boolean }): string {
  return scope.truncated ? ' (too large to show in full — leading files only)' : ''
}

/** How many commits the `commits` folder lists. */
const COMMIT_LIMIT = 50
/** How deep a typed query searches the log (filter FIRST, then cap at
 *  COMMIT_LIMIT) — so a sha / subject the 50-commit page dropped is reachable. */
const COMMIT_SEARCH_DEPTH = 500

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
type RepoBase = readonly string[]

const repoRootSegments = (pid: string): RepoBase => [pid]
const repoNodeSegments = (pid: string, relpath: string): RepoBase => [
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
const decodedSegments = (uri: string): string[] | null =>
  providerSegments(SCHEME, uri)?.map((segment) => decodeURIComponent(segment)) ?? null

const uriOf = (base: RepoBase, ...rest: string[]) => buildResourceUri(SCHEME, [...base, ...rest])
const branchesUri = (base: RepoBase) => uriOf(base, 'branches')
const commitsUri = (base: RepoBase) => uriOf(base, 'commits')
const statusUri = (base: RepoBase) => uriOf(base, 'status')
const stagedUri = (base: RepoBase) => uriOf(base, 'staged')
const unstagedUri = (base: RepoBase) => uriOf(base, 'unstaged')
const branchUri = (base: RepoBase, branch: string) => uriOf(base, 'branches', ...branch.split('/'))
const commitUri = (base: RepoBase, sha: string) => uriOf(base, 'commits', sha)
const commitFileUri = (base: RepoBase, sha: string, path: string) =>
  uriOf(base, 'commits', sha, ...path.split('/'))

/** Compact one-line ahead/behind + upstream summary for a branch detail. */
function branchDetail(branch: RepoBranch, status: RepoStatus | null): string {
  const parts: string[] = []
  if (branch.current) parts.push('current')
  if (branch.upstream) parts.push(`↑${branch.upstream}`)
  if (branch.current && status && (status.ahead > 0 || status.behind > 0)) {
    parts.push(`ahead ${status.ahead} · behind ${status.behind}`)
  }
  if (branch.updatedAt) parts.push(branch.updatedAt)
  return parts.join(' · ')
}

/** A concrete repo resolved from a URI: its git cwd + the URI prefix that
 *  identifies it + the section segments below it. */
interface RepoTarget {
  kind: 'repo'
  pid: string
  base: RepoBase
  cwd: string
  rest: string[]
}
/** The repo-CHOOSING level of a multi-root container (or the `/repos` folder). */
interface PickerTarget {
  kind: 'picker'
  pid: string
  repos: GitRepoEntry[]
}

export function createGitResourceProvider(service: ResourceGitService): ResourceRefProvider {
  /** Branch/commit folders + working-tree scope leaves of a repo. Each scope
   *  (working status / staged / unstaged) is a reviewable leaf that expands to its
   *  diff — the full hierarchy a `/review` target drills. `base` is the repo's URI. */
  function repoSectionNodes(base: RepoBase): ResourceNode[] {
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
  function repoNodes(pid: string, repos: GitRepoEntry[]): ResourceNode[] {
    return repos.map((r) => ({
      uri: buildResourceUri(SCHEME, repoNodeSegments(pid, r.relpath)),
      label: r.name,
      detail: r.relpath || undefined,
      hasChildren: true,
      icon: 'repo',
    }))
  }

  async function branchNodes(base: RepoBase, cwd: string): Promise<ResourceNode[]> {
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

  async function commitNodes(base: RepoBase, cwd: string, query?: string): Promise<ResourceNode[]> {
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

  async function commitFileNodes(
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

  /**
   * Resolve a URI's segments to either a concrete repo (`cwd` + `base` prefix +
   * the section `rest`) or the repo picker of a multi-root container. Returns null
   * when the project is unknown / not a git area, or a nested `relpath` isn't among
   * the discovered repos (the guard against a crafted `..` path). A plain single
   * repo maps the bare `<pid>` straight to its sections (no picker level — back-compat).
   */
  async function resolveTarget(
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
      const target = await resolveTarget(userId, segments)
      if (!target) return []
      if (target.kind === 'picker') return repoNodes(target.pid, target.repos)

      const { base, cwd, rest } = target
      // <repo> — the repo's sections.
      if (rest.length === 0) return repoSectionNodes(base)
      const [section, sha] = rest
      // <repo>/branches — the branch list (branch leaves).
      if (section === 'branches' && rest.length === 1) return branchNodes(base, cwd)
      // <repo>/commits — the recent commits (commit folders; query searches deeper).
      if (section === 'commits' && rest.length === 1) return commitNodes(base, cwd, query)
      // <repo>/commits/<sha> — the files that commit touched (file leaves).
      if (section === 'commits' && rest.length === 2 && sha) return commitFileNodes(base, cwd, sha)
      return []
    },

    async expand(userId, uri): Promise<ResourceExpansion> {
      const segments = decodedSegments(uri)
      if (!segments) return { ok: false, error: 'not a git resource' }
      const target = await resolveTarget(userId, segments)
      if (!target) return { ok: false, error: 'unresolvable git uri' }

      // A multi-root container — summarize its repos WITH their paths (pick one to
      // go deeper). The path tells the agent where each nested repo lives on disk.
      if (target.kind === 'picker') {
        const body = target.repos
          .map((r) => `- ${r.name} — \`${r.cwd}\`${r.relpath ? ` (${r.relpath})` : ' (root)'}`)
          .join('\n')
        return {
          ok: true,
          content: `Git container — ${target.repos.length} repositor${target.repos.length === 1 ? 'y' : 'ies'}:\n${body}`,
        }
      }

      const { cwd, rest } = target
      const [section, sha] = rest
      // Prefix every repo-node expansion with the repo's on-disk path so the agent
      // runs git / reads files in the RIGHT repo — essential for a nested repo in a
      // multi-root project, where the target isn't the session's workspace root.
      const cwdNote = `Repository path (run git / read files here): \`${cwd}\``
      const ok = (content: string, language?: string): ResourceExpansion => ({
        ok: true,
        ...(language ? { language } : {}),
        content: `${cwdNote}\n\n${content}`,
      })

      // <repo> — repo summary (branch, ahead/behind, counts, tip).
      if (rest.length === 0) {
        const [status, branches, log] = await Promise.all([
          service.getStatus(cwd).catch(() => null),
          service.listBranches(cwd).catch(() => [] as RepoBranch[]),
          service.getLog(cwd, 1).catch(() => [] as RepoCommit[]),
        ])
        const lines = [
          `Git repository (${branches.length} local ${branches.length === 1 ? 'branch' : 'branches'}).`,
        ]
        if (status) {
          lines.push(
            `On ${status.detached ? 'detached HEAD' : status.branch ? `branch ${status.branch}` : 'an unborn branch'}` +
              `${status.upstream ? ` (tracking ${status.upstream})` : ''}.`,
          )
          if (status.ahead > 0 || status.behind > 0)
            lines.push(`Ahead ${status.ahead}, behind ${status.behind}.`)
          lines.push(`Working tree: ${plural(status.files.length, 'changed file')}.`)
        }
        const tip = log[0]
        if (tip) lines.push('', `Tip: ${tip.shortHash} ${tip.subject} (${tip.relativeDate})`)
        return ok(lines.join('\n'))
      }

      // <repo>/branches — the branch listing.
      if (section === 'branches' && rest.length === 1) {
        const branches = await service.listBranches(cwd)
        const body = branches
          .map(
            (b) =>
              `- ${b.name}${b.current ? ' (current)' : ''}${b.upstream ? ` → ${b.upstream}` : ''}`,
          )
          .join('\n')
        return ok(`Branches (${branches.length}):\n${body}`)
      }

      // <repo>/branches/<branch…> — a branch summary PLUS its vs-base diff so the
      // node is a reviewable target (changes the branch added since it diverged).
      if (section === 'branches' && rest.length > 1) {
        const name = rest.slice(1).join('/')
        const [branches, status, branchDiff] = await Promise.all([
          service.listBranches(cwd),
          service.getStatus(cwd).catch(() => null),
          service.getBranchDiff(cwd, name).catch(() => null),
        ])
        const branch = branches.find((b) => b.name === name)
        if (!branch) return { ok: false, error: `branch not found: ${name}` }
        const lines = [`Branch "${branch.name}"${branch.current ? ' (current)' : ''}.`]
        if (branch.upstream) lines.push(`Upstream: ${branch.upstream}.`)
        if (branch.updatedAt) lines.push(`Last commit: ${branch.updatedAt}.`)
        if (branch.current && status) {
          if (status.ahead > 0 || status.behind > 0)
            lines.push(`Ahead ${status.ahead}, behind ${status.behind}.`)
          const tip = (await service.getLog(cwd, 1).catch(() => []))[0]
          if (tip) lines.push(`Tip: ${tip.shortHash} ${tip.subject} (${tip.relativeDate}).`)
        }
        if (branch.worktreePath) lines.push('Checked out in another worktree.')
        const diff = branchDiff?.diff?.trim()
        if (branchDiff && diff) {
          const heading = `Diff vs base (${branchDiff.base})${truncatedNote(branchDiff)}:`
          lines.push('', heading, '', '```diff', diff, '```')
        } else if (branchDiff) {
          lines.push('', `No changes vs base (${branchDiff.base}).`)
        }
        return ok(lines.join('\n'))
      }

      // <repo>/commits — the recent commits listing.
      if (section === 'commits' && rest.length === 1) {
        const commits = await service.getLog(cwd, COMMIT_LIMIT)
        const body = commits
          .map((c) => `- ${c.shortHash} ${c.subject} — ${c.author}, ${c.relativeDate}`)
          .join('\n')
        return ok(`Recent commits (${commits.length}):\n${body}`)
      }

      // <repo>/commits/<sha> — the full commit patch.
      if (section === 'commits' && rest.length === 2 && sha) {
        const [show, log] = await Promise.all([
          service.getCommitShow(cwd, sha),
          service.getLog(cwd, COMMIT_SEARCH_DEPTH).catch(() => []),
        ])
        const meta = log.find(
          (c) => c.shortHash === sha || c.hash === sha || c.hash.startsWith(sha),
        )
        // An EMPTY diff is not proof of a missing commit — a merge / empty commit
        // legitimately shows no patch. Report metadata when we know the commit.
        if (!show.diff && !meta) return { ok: false, error: `commit not found: ${sha}` }
        const header = meta
          ? `commit ${meta.shortHash} — ${meta.subject}\nauthor ${meta.author} · ${meta.relativeDate}\n`
          : `commit ${sha}\n`
        const note = show.truncated ? `patch${truncatedNote(show)}\n` : ''
        return ok(
          `${header}${note}\n${show.diff || '(no textual diff — an empty or merge commit)'}`,
          'diff',
        )
      }

      // <repo>/commits/<sha>/<path…> — a single file's diff within a commit.
      if (section === 'commits' && rest.length > 2 && sha) {
        const path = rest.slice(2).join('/')
        const diff = await service.getCommitFileDiff(cwd, sha, path)
        if (!diff) return { ok: false, error: `no diff for ${path} in ${sha}` }
        return ok(diff, 'diff')
      }

      // <repo>/status — working-tree status + working diff.
      if (section === 'status' && rest.length === 1) {
        const [status, working] = await Promise.all([
          service.getStatus(cwd).catch(() => null),
          service.getWorkingDiff(cwd).catch(() => null),
        ])
        const lines: string[] = []
        if (status) {
          lines.push(`Working tree — ${plural(status.files.length, 'changed file')}:`)
          for (const f of status.files)
            lines.push(`- ${f.status} ${f.path} (+${f.insertions} -${f.deletions})`)
        }
        const diff = working?.diff?.trim()
        const content = diff
          ? `${lines.join('\n')}\n\n\`\`\`diff\n${diff}\n\`\`\``
          : lines.join('\n') || 'Working tree is clean.'
        return ok(content)
      }

      // <repo>/staged — the staged set (index vs HEAD).
      if (section === 'staged' && rest.length === 1) {
        const scope = await service.getStagedDiff(cwd).catch(() => NO_SCOPE)
        const diff = scope.diff.trim()
        return ok(
          diff
            ? `Staged changes${truncatedNote(scope)}:\n\n\`\`\`diff\n${diff}\n\`\`\``
            : 'Nothing staged.',
        )
      }

      // <repo>/unstaged — the unstaged set (working tree vs index).
      if (section === 'unstaged' && rest.length === 1) {
        const scope = await service.getUnstagedDiff(cwd).catch(() => NO_SCOPE)
        const diff = scope.diff.trim()
        return ok(
          diff
            ? `Unstaged changes${truncatedNote(scope)}:\n\n\`\`\`diff\n${diff}\n\`\`\``
            : 'No unstaged changes.',
        )
      }

      return { ok: false, error: 'unresolvable git uri' }
    },
  }
}
