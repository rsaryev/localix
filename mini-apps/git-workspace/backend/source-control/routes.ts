import { Hono } from 'hono'
import { defaultErrorHandler } from '@localixai/mini-app-sdk/backend'
import type { MiniAppRouteContext as AppContext } from '@localixai/mini-app-sdk/backend'
import type { SourceControlService } from './service'
import type { ForgeService } from './forge/service'
import { toWorkspaceWire } from './workspace-wire'
import { z } from 'zod'
import { createForgeRoutes } from './routes/forge'
import { createHistoryRoutes } from './routes/history'
import { validated } from './routes/validated'
import {
  amendSchema,
  blameQuerySchema,
  branchAtSchema,
  commitDiffQuerySchema,
  commitNoteQuerySchema,
  commitRefSchema,
  commitSchema,
  checkoutRemoteSchema,
  createBranchSchema,
  deleteBranchSchema,
  diffLinesQuerySchema,
  fileDiffQuerySchema,
  fileHunksQuerySchema,
  gitignoreSchema,
  lineStageSchema,
  logQuerySchema,
  mergeBranchSchema,
  nukeSchema,
  pathsSchema,
  pushSchema,
  rangeDiffQuerySchema,
  renameBranchSchema,
  resetCommitSchema,
  revertHunkSchema,
  sessionQuerySchema,
  stashPushSchema,
  stashRefSchema,
  switchBranchSchema,
} from './requests'

/** Apply a stash: its index plus whether to pop (remove) it or keep it (apply). */
const stashApplySchema = stashRefSchema.extend({ pop: z.boolean().optional() })

const truthy = (v?: string) => v === '1' || v === 'true'

/** VCS-neutral source-control over the session's working dir — see features/source-control. */
export function createSourceControlRoutes(service: SourceControlService, forge: ForgeService) {
  const app = new Hono<AppContext>()

  /**
   * Turn a thrown `ApiError` into the shared `{ error: { code, message } }` body.
   *
   * This router was the only bundled one without it, and the consequence was
   * invisible from here: the backend host mounts a mini app's Hono app and serves it with
   * `wrapper.fetch(...)`, so an uncaught throw is caught by THAT app's own error
   * handling, never the host's. Every carefully typed git refusal — the whole
   * point of `git_branch_not_merged`, `git_rebase_conflict`, `git_merge_conflict`,
   * `git_push_rejected` — therefore reached the browser as a bare Hono 500 with a
   * plain-text body. `unwrapMiniAppResponse` found no envelope in it, so the UI
   * showed its generic fallback, and every `err.code === …` branch that offers the
   * recovery (Delete anyway / Abort / Force push) was unreachable code.
   */
  app.onError(defaultErrorHandler)

  return (
    app
      // Two families live in their own modules: the forge (a different system,
      // which can be absent on its own) and the history rewrites (the ops that
      // can leave the repo paused mid-apply). Merged at '/' so the RPC client
      // still sees one flat route surface.
      .route('/', createForgeRoutes(forge))
      .route('/', createHistoryRoutes(service))
      // Everything the panel reads, in one round trip: the repo inventory plus the
      // focused repo's status, branches and stashes. `repoRoot` is the caller's
      // current focus; the response echoes the one it actually described.
      .get('/workspace', validated('query', sessionQuerySchema), async (c) => {
        const { sessionId, repoRoot } = c.req.valid('query')
        const workspace = await service.getWorkspace(c.env.userId, sessionId ?? null, repoRoot)
        return c.json(toWorkspaceWire(workspace))
      })
      // Every repository discovered for a multi-root project, each with its status
      // (single entry for a normal project). Powers the grouped Changes tree.
      .get('/repos', validated('query', sessionQuerySchema), async (c) => {
        const { sessionId } = c.req.valid('query')
        return c.json({ repos: await service.listRepos(c.env.userId, sessionId ?? null) })
      })
      .get('/status', validated('query', sessionQuerySchema), async (c) => {
        const { sessionId, repoRoot } = c.req.valid('query')
        return c.json(await service.getStatus(c.env.userId, sessionId ?? null, repoRoot))
      })
      .get('/branches', validated('query', sessionQuerySchema), async (c) => {
        const { sessionId, repoRoot } = c.req.valid('query')
        return c.json(await service.getBranches(c.env.userId, sessionId ?? null, repoRoot))
      })
      .get('/log', validated('query', logQuerySchema), async (c) => {
        const { sessionId, limit, query, author, path, repoRoot } = c.req.valid('query')
        const filter = query || author || path ? { query, author, path } : undefined
        return c.json({
          commits: await service.getLog(c.env.userId, sessionId ?? null, limit, filter, repoRoot),
        })
      })
      .get('/range-diff', validated('query', rangeDiffQuerySchema), async (c) => {
        const { sessionId, from, to, threeDot, repoRoot } = c.req.valid('query')
        return c.json(
          await service.getRangeDiff(
            c.env.userId,
            sessionId ?? null,
            from,
            to,
            truthy(threeDot),
            repoRoot,
          ),
        )
      })
      .get('/blame', validated('query', blameQuerySchema), async (c) => {
        const { sessionId, path, startLine, endLine, repoRoot } = c.req.valid('query')
        const range = startLine && endLine ? { start: startLine, end: endLine } : undefined
        return c.json({
          lines: await service.getBlame(c.env.userId, sessionId ?? null, path, range, repoRoot),
        })
      })
      .get('/commit-diff', validated('query', commitDiffQuerySchema), async (c) => {
        const { sessionId, hash, repoRoot } = c.req.valid('query')
        return c.json(await service.getCommitShow(c.env.userId, sessionId ?? null, hash, repoRoot))
      })
      .get('/commit-note', validated('query', commitNoteQuerySchema), async (c) => {
        const { sessionId, hash, repoRoot } = c.req.valid('query')
        return c.json({
          note: await service.getCommitNote(c.env.userId, sessionId ?? null, hash, repoRoot),
        })
      })
      .get('/diff', validated('query', fileDiffQuerySchema), async (c) => {
        const q = c.req.valid('query')
        return c.json(
          await service.getFileDiff(
            c.env.userId,
            q.sessionId ?? null,
            {
              path: q.path,
              staged: truthy(q.staged),
              untracked: truthy(q.untracked),
            },
            q.repoRoot,
          ),
        )
      })
      .get('/working-diff', validated('query', sessionQuerySchema), async (c) => {
        const { sessionId, repoRoot } = c.req.valid('query')
        return c.json(await service.getWorkingDiff(c.env.userId, sessionId ?? null, repoRoot))
      })
      .get('/hunks', validated('query', fileHunksQuerySchema), async (c) => {
        const { sessionId, path, repoRoot } = c.req.valid('query')
        return c.json({
          path,
          hunks: await service.getFileHunks(c.env.userId, sessionId ?? null, path, repoRoot),
        })
      })
      .post('/revert-hunk', validated('json', revertHunkSchema), async (c) => {
        const { sessionId, path, index, header, repoRoot } = c.req.valid('json')
        return c.json(
          await service.revertHunk(
            c.env.userId,
            sessionId ?? null,
            { path, index, header },
            repoRoot,
          ),
        )
      })
      .get('/diff-lines', validated('query', diffLinesQuerySchema), async (c) => {
        const { sessionId, path, mode, repoRoot } = c.req.valid('query')
        return c.json(
          await service.getFileDiffLines(
            c.env.userId,
            sessionId ?? null,
            { path, mode: mode ?? 'unstaged' },
            repoRoot,
          ),
        )
      })
      .post('/stage-lines', validated('json', lineStageSchema), async (c) => {
        const { sessionId, path, lines, diffId, repoRoot } = c.req.valid('json')
        return c.json(
          await service.stageLines(
            c.env.userId,
            sessionId ?? null,
            { path, lines, diffId },
            repoRoot,
          ),
        )
      })
      .post('/unstage-lines', validated('json', lineStageSchema), async (c) => {
        const { sessionId, path, lines, diffId, repoRoot } = c.req.valid('json')
        return c.json(
          await service.unstageLines(
            c.env.userId,
            sessionId ?? null,
            { path, lines, diffId },
            repoRoot,
          ),
        )
      })
      .post('/discard-lines', validated('json', lineStageSchema), async (c) => {
        const { sessionId, path, lines, diffId, repoRoot } = c.req.valid('json')
        return c.json(
          await service.discardLines(
            c.env.userId,
            sessionId ?? null,
            { path, lines, diffId },
            repoRoot,
          ),
        )
      })
      .post('/switch', validated('json', switchBranchSchema), async (c) => {
        const { sessionId, branch, repoRoot } = c.req.valid('json')
        return c.json(await service.switchBranch(c.env.userId, sessionId ?? null, branch, repoRoot))
      })
      .post('/checkout-remote', validated('json', checkoutRemoteSchema), async (c) => {
        const { sessionId, remoteRef, repoRoot } = c.req.valid('json')
        return c.json(
          await service.checkoutRemoteBranch(c.env.userId, sessionId ?? null, remoteRef, repoRoot),
        )
      })
      .post('/merge', validated('json', mergeBranchSchema), async (c) => {
        const { sessionId, branch, noFastForward, repoRoot } = c.req.valid('json')
        return c.json(
          await service.mergeBranch(
            c.env.userId,
            sessionId ?? null,
            branch,
            noFastForward ?? false,
            repoRoot,
          ),
        )
      })
      .post('/merge-abort', validated('json', sessionQuerySchema), async (c) => {
        const { sessionId, repoRoot } = c.req.valid('json')
        return c.json(await service.abortMerge(c.env.userId, sessionId ?? null, repoRoot))
      })
      .post('/create-branch', validated('json', createBranchSchema), async (c) => {
        const { sessionId, name, repoRoot } = c.req.valid('json')
        return c.json(await service.createBranch(c.env.userId, sessionId ?? null, name, repoRoot))
      })
      .post('/rename-branch', validated('json', renameBranchSchema), async (c) => {
        const { sessionId, from, to, repoRoot } = c.req.valid('json')
        return c.json(
          await service.renameBranch(c.env.userId, sessionId ?? null, from, to, repoRoot),
        )
      })
      .post('/delete-branch', validated('json', deleteBranchSchema), async (c) => {
        const { sessionId, name, force, repoRoot } = c.req.valid('json')
        return c.json(
          await service.deleteBranch(
            c.env.userId,
            sessionId ?? null,
            name,
            force ?? false,
            repoRoot,
          ),
        )
      })
      .post('/stage', validated('json', pathsSchema), async (c) => {
        const { sessionId, paths, repoRoot } = c.req.valid('json')
        return c.json(await service.stage(c.env.userId, sessionId ?? null, paths, repoRoot))
      })
      .post('/unstage', validated('json', pathsSchema), async (c) => {
        const { sessionId, paths, repoRoot } = c.req.valid('json')
        return c.json(await service.unstage(c.env.userId, sessionId ?? null, paths, repoRoot))
      })
      .post('/discard', validated('json', pathsSchema), async (c) => {
        const { sessionId, paths, repoRoot } = c.req.valid('json')
        return c.json(await service.discard(c.env.userId, sessionId ?? null, paths, repoRoot))
      })
      .post('/gitignore', validated('json', gitignoreSchema), async (c) => {
        const { sessionId, patterns, repoRoot } = c.req.valid('json')
        return c.json(
          await service.addToGitignore(c.env.userId, sessionId ?? null, patterns, repoRoot),
        )
      })
      .post('/commit', validated('json', commitSchema), async (c) => {
        const { sessionId, message, repoRoot } = c.req.valid('json')
        return c.json(await service.commit(c.env.userId, sessionId ?? null, message, repoRoot))
      })
      .post('/amend', validated('json', amendSchema), async (c) => {
        const { sessionId, message, repoRoot } = c.req.valid('json')
        return c.json(await service.amend(c.env.userId, sessionId ?? null, message, repoRoot))
      })
      .get('/head-commit', validated('query', sessionQuerySchema), async (c) => {
        const { sessionId, repoRoot } = c.req.valid('query')
        return c.json({
          message: await service.getHeadCommitMessage(c.env.userId, sessionId ?? null, repoRoot),
        })
      })
      .get('/recent-messages', validated('query', logQuerySchema), async (c) => {
        const { sessionId, limit, repoRoot } = c.req.valid('query')
        return c.json({
          messages: await service.getRecentCommitMessages(
            c.env.userId,
            sessionId ?? null,
            limit,
            repoRoot,
          ),
        })
      })
      .post('/nuke', validated('json', nukeSchema), async (c) => {
        const { sessionId, removeUntracked, repoRoot } = c.req.valid('json')
        return c.json(
          await service.nuke(c.env.userId, sessionId ?? null, removeUntracked ?? false, repoRoot),
        )
      })
      .post('/push', validated('json', pushSchema), async (c) => {
        const { sessionId, repoRoot, force } = c.req.valid('json')
        return c.json(await service.push(c.env.userId, sessionId ?? null, repoRoot, force ?? false))
      })
      .post('/pull', validated('json', sessionQuerySchema), async (c) => {
        const { sessionId, repoRoot } = c.req.valid('json')
        return c.json(await service.pull(c.env.userId, sessionId ?? null, repoRoot))
      })
      .post('/fetch', validated('json', sessionQuerySchema), async (c) => {
        const { sessionId, repoRoot } = c.req.valid('json')
        return c.json(await service.fetch(c.env.userId, sessionId ?? null, repoRoot))
      })
      .get('/stashes', validated('query', sessionQuerySchema), async (c) => {
        const { sessionId, repoRoot } = c.req.valid('query')
        return c.json({
          stashes: await service.getStashes(c.env.userId, sessionId ?? null, repoRoot),
        })
      })
      .post('/stash', validated('json', stashPushSchema), async (c) => {
        const { sessionId, message, includeUntracked, repoRoot } = c.req.valid('json')
        return c.json(
          await service.createStash(
            c.env.userId,
            sessionId ?? null,
            { message, includeUntracked: includeUntracked ?? true },
            repoRoot,
          ),
        )
      })
      .post('/stash-apply', validated('json', stashApplySchema), async (c) => {
        const { sessionId, index, pop, repoRoot } = c.req.valid('json')
        return c.json(
          await service.applyStash(c.env.userId, sessionId ?? null, index, pop ?? false, repoRoot),
        )
      })
      .post('/stash-drop', validated('json', stashRefSchema), async (c) => {
        const { sessionId, index, repoRoot } = c.req.valid('json')
        return c.json(await service.dropStash(c.env.userId, sessionId ?? null, index, repoRoot))
      })
      .get('/stash-diff', validated('query', stashRefSchema), async (c) => {
        const { sessionId, index, repoRoot } = c.req.valid('query')
        return c.json(await service.getStashDiff(c.env.userId, sessionId ?? null, index, repoRoot))
      })
      .post('/revert', validated('json', commitRefSchema), async (c) => {
        const { sessionId, hash, repoRoot } = c.req.valid('json')
        return c.json(await service.revertCommit(c.env.userId, sessionId ?? null, hash, repoRoot))
      })
      .post('/cherry-pick', validated('json', commitRefSchema), async (c) => {
        const { sessionId, hash, repoRoot } = c.req.valid('json')
        return c.json(await service.cherryPick(c.env.userId, sessionId ?? null, hash, repoRoot))
      })
      .post('/reset', validated('json', resetCommitSchema), async (c) => {
        const { sessionId, hash, mode, repoRoot } = c.req.valid('json')
        return c.json(
          await service.resetToCommit(c.env.userId, sessionId ?? null, hash, mode, repoRoot),
        )
      })
      .post('/checkout-commit', validated('json', commitRefSchema), async (c) => {
        const { sessionId, hash, repoRoot } = c.req.valid('json')
        return c.json(await service.checkoutCommit(c.env.userId, sessionId ?? null, hash, repoRoot))
      })
      .post('/branch-at', validated('json', branchAtSchema), async (c) => {
        const { sessionId, name, hash, repoRoot } = c.req.valid('json')
        return c.json(
          await service.createBranchAt(c.env.userId, sessionId ?? null, name, hash, repoRoot),
        )
      })
  )
}

export type SourceControlRoutes = ReturnType<typeof createSourceControlRoutes>
