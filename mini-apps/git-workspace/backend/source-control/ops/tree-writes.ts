/**
 * Working-tree-only writes: hunk/line staging, stage/unstage/discard and
 * `.gitignore`. None of them moves a ref, so each answers with the refreshed
 * status alone (see `mutate`).
 */
import type { SourceControlTreeWrites } from '../service-tree-writes'
import type { RepoAccess } from './repo-access'

export function createSourceControlTreeWrites({ mutate }: RepoAccess): SourceControlTreeWrites {
  return {
    revertHunk: (userId, sessionId, input, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.revertHunk(cwd, input)),

    stageLines: (userId, sessionId, input, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.stageLines(cwd, input)),

    unstageLines: (userId, sessionId, input, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.unstageLines(cwd, input)),

    discardLines: (userId, sessionId, input, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.discardLines(cwd, input)),

    stage: (userId, sessionId, paths, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.stage(cwd, paths)),

    unstage: (userId, sessionId, paths, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.unstage(cwd, paths)),

    discard: (userId, sessionId, paths, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.discard(cwd, paths)),

    addToGitignore: (userId, sessionId, patterns, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.addToGitignore(cwd, patterns)),
  }
}
