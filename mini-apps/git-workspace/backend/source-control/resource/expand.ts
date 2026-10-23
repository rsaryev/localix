/**
 * Expand a resolved git target to model-facing text: a container's repo list,
 * or a repo node's summary, listing, branch-vs-base diff, commit patch, file
 * diff, or working / staged / unstaged diff.
 */
import type { ResourceExpansion } from '@localixai/mini-app-sdk/backend'
import { plural } from '@localixai/mini-app-sdk/backend'
import type { RepoBranch, RepoCommit } from '../contracts'
import type { ResourceGitService } from '../resource-provider'
import type { PickerTarget, RepoTarget } from './target'
import { COMMIT_LIMIT, COMMIT_SEARCH_DEPTH, NO_SCOPE, truncatedNote } from './uris'

/** A multi-root container — its repos WITH their paths (pick one to go deeper). */
export function expandPicker(target: PickerTarget): ResourceExpansion {
  const body = target.repos
    .map((r) => `- ${r.name} — \`${r.cwd}\`${r.relpath ? ` (${r.relpath})` : ' (root)'}`)
    .join('\n')
  return {
    ok: true,
    content: `Git container — ${target.repos.length} repositor${target.repos.length === 1 ? 'y' : 'ies'}:\n${body}`,
  }
}

export async function expandRepo(
  service: ResourceGitService,
  target: RepoTarget,
): Promise<ResourceExpansion> {
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
        (b) => `- ${b.name}${b.current ? ' (current)' : ''}${b.upstream ? ` → ${b.upstream}` : ''}`,
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
    const meta = log.find((c) => c.shortHash === sha || c.hash === sha || c.hash.startsWith(sha))
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
}
