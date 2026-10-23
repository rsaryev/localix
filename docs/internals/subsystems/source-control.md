# Source control

Source control resolves a session working directory to a Git repository and exposes status, diffs,
history, and mutations through one backend port. Use this page when changing repository scoping, Git
command policy, mutation guarantees, or the Source Control workspace surface.

## Terminology

| Term            | Meaning                                                                     | Boundary                                                     |
| --------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Scan root       | The named session's resolved working directory                              | It can be a repository or a container of repositories        |
| Repository root | A discovered directory containing a `.git` file or directory                | An explicit root must belong to the session's discovered set |
| Backend         | A `SourceControlBackend` implementation selected for a working directory    | Git is the only registered implementation                    |
| Status envelope | `SourceControlStatus` with repository state and backend identity            | Not a repo: `isRepo: false`; no directory yet: `unresolved`  |
| Mutation        | An operation that changes the index, worktree, refs, notes, or remote state | It requires a resolved backend and returns refreshed status  |
| Decoration read | Optional blame, provenance, stash, or commit-message metadata               | It degrades to an empty value when unavailable               |

## What you can do

| Operation                 | Mechanism                                                                        | Boundary                                                         |
| ------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Inspect repository state  | Read branch, upstream, ahead/behind, staged, unstaged, and untracked state       | Ahead/behind uses local tracking refs until fetch refreshes them |
| Read changes              | Open file, working-tree, commit, stash, or commit-range unified diffs            | Binary and missing data can produce metadata without text hunks  |
| Change the index          | Stage or unstage paths, folders, change blocks, or selected lines                | Line operations reject a stale diff fingerprint                  |
| Discard changes           | Restore a hunk, selected lines, paths, or the complete working tree              | These operations can permanently remove uncommitted work         |
| Create local history      | Commit, amend, stash, apply, pop, drop, and manage local branches                | Amend and several branch operations rewrite or delete history    |
| Operate on commits        | Revert, cherry-pick, reset, detach, branch-at, reword, fix up, rebase, or bisect | Conflicts remain ordinary Git state for manual resolution        |
| Synchronize tracking refs | Fetch with prune, fast-forward pull, or push the current branch                  | Remote authentication and prompts stay outside the panel         |
| Inspect pull requests     | Invoke authenticated `gh` commands for a GitHub remote                           | Forge failure never disables ordinary Git operations             |

The user workflow and confirmation surfaces belong to
[Use Source Control](../../features/source-control.md). This subsystem only consumes the resolved
session working directory; it does not decide what that directory is.

## How it works

### Resolution and backend dispatch

```text
user + session + optional repoRoot
  -> resolve session scan root
  -> validate explicit repoRoot against discovered roots
  -> detect SourceControlBackend for cwd
  -> run read or mutation
  -> mutation re-reads status
  -> route returns the typed result
```

| Module                                                                                             | Invariant                                                                 | Failure mode                                                                                  |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [`ports.ts`](../../../mini-apps/git-workspace/backend/source-control/ports.ts)                     | The service depends on `SourceControlBackend`, not Git modules            | Adding an operation requires every backend to implement it                                    |
| [`repos/discovery.ts`](../../../mini-apps/git-workspace/backend/source-control/repos/discovery.ts) | Discovery is bounded and stops below each repository found under the root | Unreadable directories are skipped; capped roots are omitted                                  |
| [`repos/service.ts`](../../../mini-apps/git-workspace/backend/source-control/repos/service.ts)     | An explicit `repoRoot` must match a discovered root                       | Unknown, forged, or stale roots resolve to `null`; they never retarget the primary repository |
| [`service.ts`](../../../mini-apps/git-workspace/backend/source-control/service.ts)                 | Every mutation requires a repository and returns freshly read status      | Missing repositories produce `not_a_repo`; decoration reads degrade                           |
| [`git/backend.ts`](../../../mini-apps/git-workspace/backend/source-control/git/backend.ts)         | One Git implementation maps the complete port to focused modules          | A missing method is a compile-time contract failure                                           |
| [`git/cli.ts`](../../../mini-apps/git-workspace/backend/source-control/git/cli.ts)                 | Git receives argument arrays with terminal and askpass prompting disabled | Local commands time out; non-zero exits remain caller-classified results                      |

The discovery walk is breadth-first. A repository found below the scan root becomes a boundary. The
root itself may still be traversed so a repository used as a container can expose child repositories
outside skipped directories.

Git reports paths relative to the repository top level, while a `-- <path>` pathspec is read
relative to the process directory. A session directory inside a repository would therefore miss
every file it names.
[`git/repo-root.ts`](../../../mini-apps/git-workspace/backend/source-control/git/repo-root.ts) wraps
the Git backend once, so each method receives the top level instead of the session directory. It
finds that directory by walking up to the nearest `.git` entry, which starts no process and is never
cached, so a new nested repository is seen immediately.

`RepoWorkspaceService` caches discovered roots briefly and reads their statuses with bounded
concurrency. The Source Control UI keeps one focused repository; commit, history, and singular
header actions follow that focus.

The UI store compares each poll in constant time: equal `changeVersion`s plus equal branch-level
fields mean an unchanged tree
([`snapshotIdentity.ts`](../../../mini-apps/git-workspace/ui/source-control/model/git-store/snapshotIdentity.ts)),
so an idle poll keeps every cached reference and re-renders nothing. Every write is one row of
[`mutations.ts`](../../../mini-apps/git-workspace/ui/source-control/model/git-store/mutations.ts),
whose required `bumpsLog` says whether it moves a ref the commit graph draws. The graph, the HEAD
message and the pull-request list re-read only when the HEAD stamp changes
([`headStamp.ts`](../../../mini-apps/git-workspace/ui/source-control/model/git-store/headStamp.ts)),
not each time their tab is shown again.

The panel uses shared workbench toolbars and controls; secondary Git actions live in the header's
overflow menu. Diff layout and navigation reserve a row above content instead of floating over code.
Every diff surface — the read-only tab, the live patch and the plugin's staging view — mounts the
host's [`VirtualDiff`](../../../apps/ui/src/shared/ui/diff/VirtualDiff.tsx). A patch is parsed once
into a flat document
([`diffDocument.ts`](../../../apps/ui/src/shared/ui/diff/document/diffDocument.ts)), laid out as
fixed-height rows ([`diffRows.ts`](../../../apps/ui/src/shared/ui/diff/document/diffRows.ts)) and
windowed, so mounted rows stay bounded however large the diff is.

Syntax highlighting and word marks are computed per mounted line and cached
([`lineCache.ts`](../../../apps/ui/src/shared/ui/diff/document/lineCache.ts)). Pinned file and hunk
headers are an overlay whose geometry comes from the row offsets
([`diffSticky.ts`](../../../apps/ui/src/shared/ui/diff/document/diffSticky.ts)). The staging view
([`useStagingDiff.ts`](../../../mini-apps/git-workspace/ui/source-control/model/useStagingDiff.ts))
keys each line by its raw-diff index, so a change run of the document is the payload of a block op.

### Reads and mutations

`SourceControlService` has three execution shapes:

| Shape           | Examples                                      | Invariant and failure behavior                                     |
| --------------- | --------------------------------------------- | ------------------------------------------------------------------ |
| Lenient read    | Status, branches, log, repository list        | A missing repository yields a neutral envelope or empty list       |
| Required read   | File, range, working, commit, and stash diff  | A missing repository returns `not_a_repo`                          |
| Mutation        | Stage, commit, rebase, bisect, fetch, or push | The operation completes before status is read and returned         |
| Decoration read | Blame, notes, stashes, message recall         | Backend errors become an empty value instead of breaking the panel |

A status read whose session directory the host has not resolved yet (common during startup) sets
`unresolved: true` beside `isRepo: false`. The panel shows it as loading and keeps polling; only a
resolved directory without a repository shows "Not a git repository" and keeps the idle discovery
interval. The poller is mounted per chat — on the `chat.background` surface while that chat's pane
is focused, and by the Git tab for its own chat while the tab is visible — never for "the active
session".

Session/project changes use a fresh read after any older request settles; pending directory
resolution retries at the active cadence, while negative probes remain at the idle cadence.

The poller subscribes to the chat's workspace changes (`pluginFiles.watchWorkspace`, which reports
`.git` too), so a terminal branch switch is read within the change window; the status read runs with
`GIT_OPTIONAL_LOCKS=0`, because a refreshing `git status` rewrites `.git/index` and that write would
itself be the change that schedules the next read. Line deltas come from `git diff --numstat -z`:
without `-z`, a non-ASCII path is C-quoted and a rename printed as `old => new`, neither of which
joins porcelain status by path.

Every diff read goes through
[`git/diff-read.ts`](../../../mini-apps/git-workspace/backend/source-control/git/diff-read.ts). When
a patch exceeds the 8 MB capture limit, the result sets `truncated` and keeps the complete files
that fit (a single-file diff keeps its complete lines). Before this, the overflow was treated as a
failure and the diff showed as empty. `binary` is set only when the diff has no text hunk. A commit
that changes one image and several source files therefore still renders its text. The UI's
working-tree diff samples at most 200 untracked files and caps each patch; anything left out sets
`truncated`.

A HEAD-relative command runs first, and HEAD is checked only if that command fails
([`git/head-or-unborn.ts`](../../../mini-apps/git-workspace/backend/source-control/git/head-or-unborn.ts)).
A repository with commits therefore needs one process per file diff, hunk read or line-staging read.

Commits and amends made through the service append the Localix co-author trailer. The service then
writes a best-effort Git note under `refs/notes/localix`. A successful commit is never reported as
failed because note annotation failed. The notes rewrite configuration is written once per
repository for each process run, not on every commit.

File/folder Discard restores the worktree from the index and cleans selected untracked paths; staged
content survives. Nuke with HEAD resets tracked staged and unstaged content, then optionally cleans
untracked paths. On an unborn branch it clears the index instead. The service write queue orders
host mutations and retries index-lock contention twice at 120/240 ms; it neither serializes external
Git processes nor rolls back completed commands when a later command fails.

### Partial changes and drift guards

[`line-staging.ts`](../../../mini-apps/git-workspace/backend/source-control/git/line-staging.ts)
reads a full-context Git diff, fingerprints it, builds a patch for selected raw diff-line indexes,
and pipes that patch to `git apply`. Stage applies forward to the index; unstage and discard
reverse-apply.

The file diff is re-read immediately before application. A different fingerprint returns
`line_stage_stale`, preventing a selection from applying to a newer file state. A diff that exceeds
the capture limit has no selectable lines (`truncated: true`). Any line operation on it returns
`line_stage_too_large`, because a patch built from a cut diff would stage lines that Git never
finished printing.

[`hunks.ts`](../../../mini-apps/git-workspace/backend/source-control/git/hunks.ts) reads
zero-context hunks for editor gutter actions. Revert re-derives the hunk, validates its index and
header, confines the path to the repository, and splices the committed lines into the file.
Untracked and binary files do not offer granular hunk revert. When the diff is truncated, the last
hunk may be incomplete, so it is dropped and cannot be reverted.

### History operations

| Family            | Owning module                                                                                | Invariant                                                               | Failure boundary                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Branches          | [`branches.ts`](../../../mini-apps/git-workspace/backend/source-control/git/branches.ts)     | Git validates names and worktree occupancy                              | Safe delete refuses unmerged work; force delete uses `-D`                          |
| Commit operations | [`commit-ops.ts`](../../../mini-apps/git-workspace/backend/source-control/git/commit-ops.ts) | Hashes and reset modes become separate argv tokens                      | Revert and cherry-pick conflicts leave Git's sequencer state                       |
| Rebase            | [`rebase.ts`](../../../mini-apps/git-workspace/backend/source-control/git/rebase.ts)         | A generated todo is installed through a non-interactive sequence editor | Dirty trees are refused; conflicts leave rebase state for continue, skip, or abort |
| Bisect            | [`bisect.ts`](../../../mini-apps/git-workspace/backend/source-control/git/bisect.ts)         | Git refs and files remain the source of bisect state                    | Invalid starting refs are rejected before a stuck session can begin                |
| Stash             | [`stash.ts`](../../../mini-apps/git-workspace/backend/source-control/git/stash.ts)           | Stash indexes are validated integers                                    | Missing entries and conflicts use typed errors                                     |

The panel has no separate merge-conflict editor. Rebase, revert, and cherry-pick conflicts appear in
the normal Changes tree; users resolve and stage files through the existing editor or terminal.

### Remote and forge boundaries

[`remote-ops.ts`](../../../mini-apps/git-workspace/backend/source-control/git/remote-ops.ts)
implements `fetch --prune`, `pull --ff-only`, and push. Push retries with `-u origin HEAD` only when
Git reports that the current branch lacks an upstream.

Forge integration is a separate port under
[`forge/`](../../../mini-apps/git-workspace/backend/source-control/forge/ports.ts). The current
backend invokes `gh` without reading or storing its token. Missing CLI, missing authentication, and
a non-GitHub remote produce unavailable forge state while Git status and mutations continue working.

The availability probe in
[`gh-status.ts`](../../../mini-apps/git-workspace/backend/source-control/forge/gh-status.ts) runs
`gh auth status` and `gh repo view` concurrently; a missing binary is the spawn's `ENOENT`, so no
`gh --version` runs. The probe caches the in-flight promise for 60 seconds, process-wide for
authentication and per repository root for the remote, so concurrent callers share one pair of
spawns. No Git event invalidates it; a new `gh` login is picked up when the TTL lapses. The panel
requests forge status and pull requests only while its work item is visible.

## Configuration

| Control                       | Default                      | Effect and boundary                                    |
| ----------------------------- | ---------------------------- | ------------------------------------------------------ |
| Discovery depth               | 4 levels below the scan root | Directories beyond the bound are not inspected         |
| Discovery repository cap      | 200                          | Stops a runaway container walk                         |
| Discovery cache               | 20 seconds                   | Scoped by scan root                                    |
| Repository status concurrency | 8                            | Bounds multi-root status reads                         |
| Service log limit             | 30 commits                   | Callers may request another bounded route value        |
| Panel log page                | 40 commits                   | The current Commit Graph request size                  |
| Local Git deadline            | 30 seconds                   | Push, pull, fetch, and clone use a ten-minute deadline |
| Git output ceiling            | 8,000,000 bytes              | Applies per invocation                                 |
| Workspace change window       | 2 seconds                    | One read per window of file changes, from the first    |
| Backstop poll with live watch | 120 seconds                  | The watcher signal drives reads; this catches its gaps |
| Visible polling while running | 6 seconds                    | No live watch (remote session, failed watcher) only    |
| Visible polling while idle    | 30 seconds                   | No live watch only; event triggers can refresh sooner  |

Directory discovery skips hidden directories plus `node_modules`, `dist`, `build`, `out`, `target`,
`vendor`, and `coverage`.

## Limits

- Git is the only backend registered today. The backend port is an extension seam, not evidence of
  another supported version-control system.
- An explicit multi-root target fails closed. A stale UI root cannot silently operate on the scan
  root or another discovered repository.
- Fetch, pull, push, and clone default to a ten-minute wall-clock deadline. HTTP transfers also set
  a 1,000-byte/second low-speed limit for 60 seconds; SSH relies on the wall-clock backstop. An
  explicit timeout overrides these defaults, with zero disabling it.
- Pull is fast-forward only. Diverged branches require an explicit rebase or merge outside that
  action.
- Git terminal prompting and askpass are disabled. The panel cannot answer signing, SSH, hook,
  credential, or editor prompts; a helper that still waits can reach the process deadline.
- Discard, Nuke, hard reset, force branch delete, stash drop, and history rewrites can remove data.
  The subsystem does not provide a general undo stack.
- Nuke uses `git clean -fd`, not `-fdx`; ignored files survive even when untracked removal is
  enabled. It runs at the repository top level, so it cleans the whole tree even from a subfolder
  session.
- Source-control commits receive notes and a co-author trailer only through the service path.
  Terminal-created commits bypass that annotation path.
- Forge support is GitHub-only and requires `gh`. Pull-request listing is not part of the Git status
  polling loop.

## Related guides

- [Use Source Control](../../features/source-control.md)
- [Workspace](../../features/workspace.md)
- [Plugins](../../extending/plugins.md)

## Source of truth

- [Backend contract](../../../mini-apps/git-workspace/backend/source-control/ports.ts)
- [Source-control service](../../../mini-apps/git-workspace/backend/source-control/service.ts)
- [RPC routes](../../../mini-apps/git-workspace/backend/source-control/routes.ts)
- [Git backend composition](../../../mini-apps/git-workspace/backend/source-control/git/backend.ts)
- [Git process boundary](../../../mini-apps/git-workspace/backend/source-control/git/cli.ts)
- [Repository top level](../../../mini-apps/git-workspace/backend/source-control/git/repo-root.ts)
- [Diff reads and truncation](../../../mini-apps/git-workspace/backend/source-control/git/diff-read.ts)
- [Repository discovery](../../../mini-apps/git-workspace/backend/source-control/repos/discovery.ts)
- [Repository scope validation](../../../mini-apps/git-workspace/backend/source-control/repos/service.ts)
- [Git mutations and remote policy](../../../mini-apps/git-workspace/backend/source-control/git/actions.ts)
- [Line-level staging](../../../mini-apps/git-workspace/backend/source-control/git/line-staging.ts)
- [Granular hunk revert](../../../mini-apps/git-workspace/backend/source-control/git/hunks.ts)
- [Forge service](../../../mini-apps/git-workspace/backend/source-control/forge/service.ts)
- [Forge availability probe](../../../mini-apps/git-workspace/backend/source-control/forge/gh-status.ts)
- [Source Control store](../../../mini-apps/git-workspace/ui/source-control/model/store.ts)
- [Source Control panel](../../../mini-apps/git-workspace/ui/source-control/ui/SourceControlTab.tsx)
