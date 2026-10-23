/**
 * VCS-neutral source-control over a session's working directory. Mirrors the
 * mini app backend port: the polled workspace snapshot, diffs and history, every
 * write, and the GitHub forge calls. All reads are scoped to a `sessionId`
 * (whose working dir the backend resolves). An optional `repoRoot` targets one
 * repository of a multi-root project (a container of several git repos);
 * omitted → the session's primary repo.
 *
 * One object, five files. It was one 766-line file, which the repo's size
 * ratchet was about to bite; the split follows lines that already meant
 * something — what only OBSERVES, and then the writes grouped by what each one
 * invalidates (working tree / refs and remote / history), which is exactly the
 * grouping the backend contract and `SourceControlMutation` already draw. The
 * forge calls stand apart because they are a different system, one that can be
 * absent without git being any less available.
 */
import { forgeApi } from './api/forge'
import { historyWrites } from './api/history-writes'
import { refWrites } from './api/ref-writes'
import { sourceControlReads } from './api/reads'
import { treeWrites } from './api/tree-writes'

export const sourceControlApi = {
  ...sourceControlReads,
  ...treeWrites,
  ...refWrites,
  ...historyWrites,
  ...forgeApi,
}
