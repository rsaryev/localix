/**
 * The git implementation of `SourceControlBackend`. A thin adapter: it binds a
 * runner to the working directory and delegates to the op modules. All git
 * knowledge lives here and under git/ — the service never imports these.
 */
import type { SourceControlBackend } from '../ports'
import { gitRunner, isGitRepo } from './cli'
import { collectStatus } from './status'
import {
  abortMerge,
  checkoutRemoteBranch,
  createBranch,
  deleteBranch,
  listBranches,
  listRemoteBranches,
  mergeBranch,
  renameBranch,
  switchBranch,
} from './branches'
import { getFileDiff } from './diff'
import { getWorkingDiff, UI_WORKING_DIFF_LIMITS } from './working-diff'
import { getFileHunks, revertHunk } from './hunks'
import { discardLines, getFileDiffLines, stageLines, unstageLines } from './line-staging'
import { getHeadCommitMessage, getLog, getRecentCommitMessages } from './log'
import { getCommitFileDiff, getCommitFiles, getCommitShow, getRangeDiff } from './show'
import { blameFile } from './blame'
import {
  checkoutCommit,
  cherryPick,
  createBranchAt,
  resetToCommit,
  revertCommit,
} from './commit-ops'
import {
  addToGitignore,
  amend,
  commit,
  discard,
  getCommitDiff,
  nukeWorkingTree,
  stage,
  unstage,
} from './actions'
import { fetchRemote, pull, push } from './remote-ops'
import { applyStash, createStash, dropStash, listStashes, showStash } from './stash'
import {
  ensureNotesRewriteConfig,
  listNotedCommits,
  readCommitNote,
  resolveHead,
  writeCommitNote,
} from './notes'
import {
  fixupInto,
  interactiveRebase,
  rebaseAbort,
  rebaseContinue,
  rebaseOnto,
  rebaseSkip,
  rewordCommit,
} from './rebase'
import { bisectMark, bisectReset, bisectStart } from './bisect'
import { atRepoRoot } from './repo-root'

export function createGitBackend(): SourceControlBackend {
  // Every op runs at the repo top level, never a subfolder cwd (see repo-root.ts).
  return atRepoRoot({
    id: 'git',
    detect: (cwd) => isGitRepo(cwd),
    getStatus: (cwd, signal) => collectStatus(gitRunner(cwd, signal), cwd),
    listBranches: (cwd) => listBranches(gitRunner(cwd)),
    listRemoteBranches: (cwd) => listRemoteBranches(gitRunner(cwd)),
    checkoutRemoteBranch: (cwd, remoteRef) => checkoutRemoteBranch(gitRunner(cwd), remoteRef),
    mergeBranch: (cwd, branch, opts) => mergeBranch(gitRunner(cwd), branch, opts),
    abortMerge: (cwd) => abortMerge(gitRunner(cwd)),
    getLog: (cwd, limit, filter) => getLog(gitRunner(cwd), limit, filter),
    getRangeDiff: (cwd, from, to, threeDot) => getRangeDiff(gitRunner(cwd), from, to, threeDot),
    getFileDiff: (cwd, input) => getFileDiff(gitRunner(cwd), cwd, input),
    getWorkingDiff: (cwd) => getWorkingDiff(gitRunner(cwd), cwd, undefined, UI_WORKING_DIFF_LIMITS),
    getFileHunks: (cwd, path) => getFileHunks(gitRunner(cwd), path),
    revertHunk: (cwd, input) => revertHunk(gitRunner(cwd), cwd, input),
    getFileDiffLines: (cwd, input) => getFileDiffLines(gitRunner(cwd), cwd, input),
    stageLines: (cwd, input) => stageLines(gitRunner(cwd), cwd, input),
    unstageLines: (cwd, input) => unstageLines(gitRunner(cwd), cwd, input),
    discardLines: (cwd, input) => discardLines(gitRunner(cwd), cwd, input),
    blame: (cwd, file, range) => blameFile(gitRunner(cwd), file, range),
    getCommitShow: (cwd, hash) => getCommitShow(gitRunner(cwd), hash),
    getCommitFiles: (cwd, hash) => getCommitFiles(gitRunner(cwd), hash),
    getCommitFileDiff: (cwd, hash, path) => getCommitFileDiff(gitRunner(cwd), hash, path),
    revertCommit: (cwd, hash) => revertCommit(gitRunner(cwd), hash),
    cherryPick: (cwd, hash) => cherryPick(gitRunner(cwd), hash),
    resetToCommit: (cwd, hash, mode) => resetToCommit(gitRunner(cwd), hash, mode),
    checkoutCommit: (cwd, hash) => checkoutCommit(gitRunner(cwd), hash),
    createBranchAt: (cwd, name, hash) => createBranchAt(gitRunner(cwd), name, hash),
    switchBranch: (cwd, branch) => switchBranch(gitRunner(cwd), branch),
    createBranch: (cwd, name) => createBranch(gitRunner(cwd), name),
    renameBranch: (cwd, from, to) => renameBranch(gitRunner(cwd), from, to),
    deleteBranch: (cwd, name, force) => deleteBranch(gitRunner(cwd), name, force),
    stage: (cwd, paths) => stage(gitRunner(cwd), paths),
    unstage: (cwd, paths) => unstage(gitRunner(cwd), paths),
    discard: (cwd, paths) => discard(gitRunner(cwd), paths),
    addToGitignore: (cwd, patterns) => addToGitignore(cwd, patterns),
    commit: (cwd, message) => commit(gitRunner(cwd), message),
    amend: (cwd, message) => amend(gitRunner(cwd), message),
    getHeadCommitMessage: (cwd) => getHeadCommitMessage(gitRunner(cwd)),
    getRecentCommitMessages: (cwd, limit, signal) =>
      getRecentCommitMessages(gitRunner(cwd, signal), limit),
    listStashes: (cwd) => listStashes(gitRunner(cwd)),
    createStash: (cwd, input) => createStash(gitRunner(cwd), input),
    applyStash: (cwd, index, pop) => applyStash(gitRunner(cwd), index, pop),
    dropStash: (cwd, index) => dropStash(gitRunner(cwd), index),
    showStash: (cwd, index) => showStash(gitRunner(cwd), index),
    nukeWorkingTree: (cwd, opts) => nukeWorkingTree(gitRunner(cwd), opts),
    push: (cwd, opts) => push(gitRunner(cwd), opts),
    pull: (cwd) => pull(gitRunner(cwd)),
    fetch: (cwd) => fetchRemote(gitRunner(cwd)),
    getCommitDiff: (cwd, signal) => getCommitDiff(gitRunner(cwd, signal), cwd),
    writeCommitNote: async (cwd, sha, note) => {
      const run = gitRunner(cwd)
      // Ensure rebase/amend copy our notes, then attach (both best-effort).
      await ensureNotesRewriteConfig(run, cwd)
      await writeCommitNote(run, sha, note)
    },
    interactiveRebase: (cwd, fromHash, entries) =>
      interactiveRebase(gitRunner(cwd), cwd, fromHash, entries),
    rewordCommit: (cwd, hash, message) => rewordCommit(gitRunner(cwd), cwd, hash, message),
    fixupInto: (cwd, hash) => fixupInto(gitRunner(cwd), cwd, hash),
    rebaseOnto: (cwd, base) => rebaseOnto(gitRunner(cwd), cwd, base),
    rebaseContinue: (cwd) => rebaseContinue(gitRunner(cwd), cwd),
    rebaseAbort: (cwd) => rebaseAbort(gitRunner(cwd)),
    rebaseSkip: (cwd) => rebaseSkip(gitRunner(cwd), cwd),
    bisectStart: (cwd, bad, good) => bisectStart(gitRunner(cwd), cwd, bad, good),
    bisectMark: (cwd, term) => bisectMark(gitRunner(cwd), cwd, term),
    bisectReset: (cwd) => bisectReset(gitRunner(cwd), cwd),
    resolveHead: (cwd) => resolveHead(gitRunner(cwd)),
    readCommitNote: (cwd, sha) => readCommitNote(gitRunner(cwd), sha),
    listNotedCommits: (cwd) => listNotedCommits(gitRunner(cwd)),
  })
}
