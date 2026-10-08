/**
 * A dev server the agent started OPENS ITS PREVIEW — by push, the way a PTY the agent
 * spawned opens its terminal tab.
 *
 * Until now the detected URL was only REMEMBERED, and the preview opened lazily on the
 * first `browser` drive. That made the terminal and the preview behave
 * differently for the same act: spawn a shell and a tab appears; start a server and
 * nothing appears until the model decides to inspect it. Observed on a real session, the
 * model started the server, verified it with curl, linked the URL in prose, and when asked
 * to open the preview said the tool was absent — the drive that would have opened it never
 * came, so the user never saw a thing. Opening on detection removes the model from that
 * path entirely, exactly as `announcePtyOpen` does for terminals.
 *
 * `opened` is marked only when the open SUCCEEDS. A banner can print before the socket
 * accepts, so a failed liveness probe is retried once shortly after; if that fails too the
 * target stays unopened and the existing lazy drive path picks it up later.
 */
import { isToolDirect, type RunProfile } from '../../../agent-core/run-shape'
import { TOOL } from '../../../agent-core/tool-names'
import {
  openPreviewCore,
  type OpenPreviewCoreInput,
  type OpenPreviewCoreResult,
} from '../../../agent-core/tools/preview/open-preview'
import type { SessionRecord } from '../../repository'
import type { RunnerDeps } from '../agent-runner-types'

/** How long a server may take to accept after printing its banner. */
export const AUTO_OPEN_RETRY_MS = 1_000

export interface PreviewTargetRecorderInput {
  deps: RunnerDeps
  userId: string
  session: SessionRecord
  defaultCwd: string
  agentProfile: RunProfile
  /** The open itself; injectable so the push can be tested without a real preview host. */
  open?: (input: OpenPreviewCoreInput) => Promise<OpenPreviewCoreResult>
  /** The retry wait; injectable for tests. */
  delay?: (ms: number) => Promise<void>
}

/**
 * The callback the bash tool fires when a background job advertises a URL. Records the
 * target, then opens it when this run can preview at all — a run whose profile hides
 * `browser` (a delegated task run, an automation) has no preview to open.
 */
export function buildPreviewTargetRecorder(
  input: PreviewTargetRecorderInput,
): ((url: string, startCommand?: string, startCwd?: string) => void) | undefined {
  const { deps, userId, session, defaultCwd, agentProfile } = input
  const targets = deps.previewTargets
  if (!targets) return undefined
  const canPreview = isToolDirect(agentProfile, TOOL.browser) && Boolean(deps.previewControl)
  const open =
    input.open ??
    ((openInput: OpenPreviewCoreInput) =>
      openPreviewCore(
        { userId, sessionId: session.id, streamRegistry: deps.streamRegistry, defaultCwd },
        openInput,
      ))
  const delay = input.delay ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))

  return (url, startCommand, startCwd) => {
    // The command comes from the job that printed the banner, so an auto-detected preview
    // knows how to come back — the same relaunch an explicit `open` with `start_command`
    // gets. Only the DETECTION stays content-based.
    targets.record(userId, session.id, {
      url,
      ...(startCommand ? { startCommand, startCwd: startCwd ?? defaultCwd } : {}),
    })
    if (!canPreview) return
    const target = targets.get(userId, session.id)
    // Same origin re-detected (a restart, a second banner line) keeps `opened` — nothing to do.
    if (!target?.url || target.opened) return
    const attempt = () =>
      open({
        url: target.url,
        title: target.title,
        start_command: target.startCommand,
        start_cwd: target.startCwd,
      })
    void attempt()
      .then(async (result) => {
        if (result.ok) return result
        await delay(AUTO_OPEN_RETRY_MS)
        return attempt()
      })
      .then((result) => {
        if (result.ok) targets.markOpened(userId, session.id)
      })
      .catch((error) => {
        console.warn(`[preview] auto-open failed for session ${session.id}`, error)
      })
  }
}
