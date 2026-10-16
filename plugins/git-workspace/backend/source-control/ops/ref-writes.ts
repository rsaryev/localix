/**
 * Writes that move a ref, rewrite history, or talk to a remote. Each answers
 * with the branch list alongside the refreshed status; commit and amend also
 * attach a best-effort provenance note to the new HEAD.
 */
import type { CommitNote } from '../contracts'
import type { SourceControlBackend } from '../ports'
import type { SourceControlRefWrites } from '../service-ref-writes'
import type { RepoAccess } from './repo-access'

export interface SourceControlRefWriteDeps {
  /** Optional: enrich the commit provenance note with the session's model. */
  resolveCommitNoteMeta?: (input: {
    userId: string
    sessionId: string
  }) => Promise<{ model?: string; rationale?: string } | null>
}

export function createSourceControlRefWrites(
  { mutate }: RepoAccess,
  deps: SourceControlRefWriteDeps,
): SourceControlRefWrites {
  /**
   * Best-effort provenance: attach a localix git note to the current HEAD after a
   * commit/amend. A failure here must NEVER surface — the user's commit already
   * succeeded (the note is a nicety, not the source of truth).
   */
  async function annotateHead(
    backend: SourceControlBackend,
    cwd: string,
    userId: string,
    sessionId: string | null,
    message: string,
  ): Promise<void> {
    try {
      const sha = await backend.resolveHead(cwd)
      if (!sha) return
      const meta =
        sessionId && deps.resolveCommitNoteMeta
          ? await deps.resolveCommitNoteMeta({ userId, sessionId }).catch(() => null)
          : null
      const note: CommitNote = {
        sessionId,
        createdAt: new Date().toISOString(),
        ...(meta?.model ? { model: meta.model } : {}),
        // Default rationale = the commit subject (first line) when none given.
        rationale: meta?.rationale ?? (message.split('\n')[0]?.trim() || undefined),
      }
      await backend.writeCommitNote(cwd, sha, note)
    } catch {
      /* provenance is best-effort — swallow */
    }
  }

  return {
    revertCommit: (userId, sessionId, hash, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.revertCommit(cwd, hash), {
        branches: true,
      }),

    cherryPick: (userId, sessionId, hash, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.cherryPick(cwd, hash), { branches: true }),

    resetToCommit: (userId, sessionId, hash, mode, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.resetToCommit(cwd, hash, mode), {
        branches: true,
      }),

    checkoutCommit: (userId, sessionId, hash, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.checkoutCommit(cwd, hash), {
        branches: true,
      }),

    createBranchAt: (userId, sessionId, name, hash, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.createBranchAt(cwd, name, hash), {
        branches: true,
      }),

    switchBranch: (userId, sessionId, branch, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.switchBranch(cwd, branch), {
        branches: true,
      }),

    checkoutRemoteBranch: (userId, sessionId, remoteRef, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.checkoutRemoteBranch(cwd, remoteRef), {
        branches: true,
      }),

    mergeBranch: (userId, sessionId, branch, noFastForward, repoRoot) =>
      mutate(
        userId,
        sessionId,
        repoRoot,
        (b, cwd) => b.mergeBranch(cwd, branch, { noFastForward }),
        {
          branches: true,
        },
      ),

    abortMerge: (userId, sessionId, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.abortMerge(cwd), { branches: true }),

    createBranch: (userId, sessionId, name, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.createBranch(cwd, name), {
        branches: true,
      }),

    renameBranch: (userId, sessionId, from, to, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.renameBranch(cwd, from, to), {
        branches: true,
      }),

    deleteBranch: (userId, sessionId, name, force, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.deleteBranch(cwd, name, force), {
        branches: true,
      }),

    commit: (userId, sessionId, message, repoRoot) =>
      mutate(
        userId,
        sessionId,
        repoRoot,
        async (b, cwd) => {
          await b.commit(cwd, message)
          await annotateHead(b, cwd, userId, sessionId, message)
        },
        { branches: true },
      ),

    amend: (userId, sessionId, message, repoRoot) =>
      mutate(
        userId,
        sessionId,
        repoRoot,
        async (b, cwd) => {
          await b.amend(cwd, message)
          // Amend rewrites HEAD to a new sha; re-annotate it with fresh provenance.
          await annotateHead(b, cwd, userId, sessionId, message)
        },
        { branches: true },
      ),

    nuke: (userId, sessionId, removeUntracked, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.nukeWorkingTree(cwd, { removeUntracked }), {
        branches: true,
      }),

    interactiveRebase: (userId, sessionId, fromHash, entries, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.interactiveRebase(cwd, fromHash, entries), {
        branches: true,
      }),

    rewordCommit: (userId, sessionId, hash, message, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.rewordCommit(cwd, hash, message), {
        branches: true,
      }),

    fixupInto: (userId, sessionId, hash, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.fixupInto(cwd, hash), { branches: true }),

    rebaseOnto: (userId, sessionId, base, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.rebaseOnto(cwd, base), { branches: true }),

    rebaseContinue: (userId, sessionId, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.rebaseContinue(cwd), { branches: true }),

    rebaseAbort: (userId, sessionId, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.rebaseAbort(cwd), { branches: true }),

    rebaseSkip: (userId, sessionId, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.rebaseSkip(cwd), { branches: true }),

    bisectStart: (userId, sessionId, bad, good, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.bisectStart(cwd, bad, good), {
        branches: true,
      }),

    bisectMark: (userId, sessionId, term, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.bisectMark(cwd, term), { branches: true }),

    bisectReset: (userId, sessionId, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.bisectReset(cwd), { branches: true }),

    push: (userId, sessionId, repoRoot, force) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.push(cwd, { force }), { branches: true }),

    pull: (userId, sessionId, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.pull(cwd), { branches: true }),

    fetch: (userId, sessionId, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.fetch(cwd), { branches: true }),

    createStash: (userId, sessionId, input, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.createStash(cwd, input), {
        branches: true,
        stashes: true,
      }),

    applyStash: (userId, sessionId, index, pop, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.applyStash(cwd, index, pop), {
        branches: true,
        stashes: true,
      }),

    dropStash: (userId, sessionId, index, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.dropStash(cwd, index), {
        branches: true,
        stashes: true,
      }),
  }
}
