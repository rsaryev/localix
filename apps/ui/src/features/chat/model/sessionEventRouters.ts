import { autoReveal } from '@/shared/lib/inspectorBus'
import { previewControlBus } from '@/shared/lib/previewControlBus'
import { publishFsChange } from '@/shared/lib/fsChangeBus'
import { terminal as terminalBus } from '@/shared/lib/terminalBus'
import type { AgentStreamEvent } from '@/shared/api/contracts'
import { pickDocumentPaths } from '@/shared/lib/contentTypeRouting'
import { usePreviewStore } from '@/features/inspector/model/previewStore'
import { revealPreview } from '@/features/inspector/model/revealPreview'
import { useLiveTerminalsStore } from '@/features/terminal/model/liveTerminals'
import { forgetTerminalState } from '@/features/terminal/model/terminalStates'
import { useUserSettings } from '@/features/settings/model/useUserSettings'
import { decideFollowReveal } from './followAgentEdits'
import { useChatStore } from './store'
import { originOf } from '@/shared/lib/url'
import { backendClient } from '@/shared/api/client'
import { closeNativePages } from '@/features/inspector/model/nativePages'
import { openPolicy, workspaceOf } from '@/shared/lib/workspaceOf'

import { forwardableSessionPhase } from '@localixai/plugin-sdk/ui'
import { pluginCommandBus } from '@localixai/plugin-sdk/ui/commands'
import { pluginSessionEventBus } from './pluginSessionEventBus'

/**
 * Typed plugin→UI command (`session.emitCommand` on the backend): dispatch to the
 * per-plugin sink registry, never through the store. The frame is
 * replayable and non-coalescing; the bus dedups replays by `commandId`. The router
 * only computes the focus-policy input — whether the command came from the ACTIVE
 * session — so plugin sinks can honor "background sessions must not steal focus"
 * (mirroring the fs-document auto-open guard) without importing the chat store.
 */
export function routePluginCommand(
  sessionId: string,
  parsed: Extract<AgentStreamEvent, { type: 'plugin.command' }>,
): void {
  pluginCommandBus.publish(
    {
      sessionId,
      plugin: parsed.plugin,
      channel: parsed.channel,
      payload: parsed.payload,
      commandId: parsed.commandId,
      seq: parsed.seq,
    },
    openPolicy(useChatStore.getState().activeSessionId, sessionId) === 'focus',
    // Reply seam for AWAITED commands (`emitCommandWithReply`): the sink's answer
    // rides the `plugin-command-result` WS RPC back to settle the server-side
    // pending promise, correlated by this frame's commandId. Fire-and-forget —
    // a lost socket just lets the server time out to its honest noReply.
    (payload) => void backendClient.pluginCommandResult(parsed.commandId, payload).catch(() => {}),
  )
}

/**
 * Forward a SAFE session-lifecycle signal to bridged plugin views. The SDK
 * allow-list ({@link forwardableSessionPhase}) decides which internal event
 * types may cross and under which phase — only run start/completed/failed, and
 * only their phase + session id (never tool payloads, error text or secrets).
 * Non-forwardable types are a no-op. Additive: it never consumes the event, so
 * the normal store/toast handling still runs.
 */
export function routePluginSessionEvent(sessionId: string, type: string): void {
  const phase = forwardableSessionPhase(type)
  if (phase) pluginSessionEventBus.publish({ sessionId, phase })
}

/**
 * On-disk file change under a session's workspace: relay to the file-tree sidebar via
 * the bus (not the store — the tree owns its own lazy-loaded state). Transient and
 * idempotent: the sidebar reloads exactly the changed directories it has open.
 */
export function routeFsChanged(
  sessionId: string,
  parsed: Extract<AgentStreamEvent, { type: 'fs.changed' }>,
): void {
  publishFsChange({
    sessionId,
    paths: parsed.paths,
    ...(parsed.changedPaths === undefined ? {} : { changedPaths: parsed.changedPaths }),
    ...(parsed.live === undefined ? {} : { live: parsed.live }),
  })
}

// Document files (pdf/office/csv/xlsx) already auto-opened per session — so a
// re-write of the same file (or an fs.changed replay) doesn't re-pop its viewer.
// Capped like the other per-session guards so a long-lived tab can't grow it
// unbounded.
const openedDocuments = new Map<string, Set<string>>()
// Bound the auto-opens per session — a pathological build that emits dozens of
// spreadsheets shouldn't bury the workspace in tabs.
const MAX_AUTO_OPENED_DOCS = 12

/**
 * Auto-open agent-PRODUCED documents. The fs-watch `fs.changed` event carries the
 * absolute paths that changed under the session's workspace (files AND their parent
 * directories); `pickDocumentPaths` keeps only the ones with a dedicated viewer
 * (pdf/docx/odt/pptx/xlsx/csv). Each such file, the FIRST time it appears, pops its
 * viewer tab (PDF/Document/Table) through the shared auto-reveal seam — decoupling
 * "the agent produced a file" from "the app surfaced it" without a bespoke tool.
 *
 * Gated to the ACTIVE session only: a background worker/sub-agent producing files
 * must not steal the workspace the user is looking at; the reveal names the event's
 * session, so the tab opens in that chat's grid. Server-side debounced (250ms) + a per-session
 * seen-set makes replay-on-reconnect and repeated writes idempotent.
 */
export function routeFsDocumentsOpened(
  sessionId: string,
  parsed: Extract<AgentStreamEvent, { type: 'fs.changed' }>,
): void {
  // Opening a document takes focus, so only the conversation on screen may (`openPolicy`).
  if (openPolicy(useChatStore.getState().activeSessionId, sessionId) !== 'focus') return
  const docs = pickDocumentPaths(parsed.paths)
  if (docs.length === 0) return
  let seen = openedDocuments.get(sessionId)
  if (!seen) {
    seen = new Set<string>()
    openedDocuments.set(sessionId, seen)
    if (openedDocuments.size > 500) {
      const oldest = openedDocuments.keys().next().value
      if (oldest && oldest !== sessionId) openedDocuments.delete(oldest)
    }
  }
  for (const path of docs) {
    if (seen.has(path) || seen.size >= MAX_AUTO_OPENED_DOCS) continue
    seen.add(path)
    // `important: true` mirrors the preview/table/review auto-opens — surface the
    // produced artifact even into a closed panel. Lands in the editor grid area, not
    // over the chat, so it never hides the conversation.
    autoReveal({ kind: 'file', sessionId, path }, { important: true })
  }
}

// Code files already gently revealed per session under "Follow the agent's edits",
// so a re-write of the same file (or an fs.changed replay on reconnect) doesn't
// re-reveal it. Capped like the sibling document guard so a long-lived tab can't
// grow it unbounded.
const followedEdits = new Map<string, Set<string>>()
const MAX_FOLLOWED_EDITS = 12

/**
 * "Follow the agent's edits" — OPT-IN, default OFF.
 * Sibling to {@link routeFsDocumentsOpened} off the SAME `fs.changed` event: when the
 * `agentSettings.followAgentEdits` toggle is on, gently reveal the most-recent NORMAL
 * code/text file the ACTIVE session's agent just wrote so the user can watch it work.
 *
 * A COMPLETE no-op when the setting is off → zero behavior change from today. Reuses
 * the doc router's guards: ACTIVE session only (a background worker/sub-agent must
 * not steal the workspace) + a per-session seen-set + cap (never re-reveal the same
 * file, idempotent on replay/reconnect). Unlike the document auto-open, this reveal
 * is GENTLE (no `important`): it lands in the editor grid area only when a panel is
 * already open and never pops over the chat or a closed panel — following, not
 * yanking. `pickCodeEditablePaths` excludes directories, dotfiles, the viewer-doc
 * types the sibling router owns, and binaries, so the two never fight over a file.
 */
export function routeFollowAgentEdits(
  sessionId: string,
  parsed: Extract<AgentStreamEvent, { type: 'fs.changed' }>,
): void {
  const enabled =
    useUserSettings.getState().settings.agentSettings?.followAgentEdits?.enabled ?? false
  if (!enabled) return
  const isActiveSession = openPolicy(useChatStore.getState().activeSessionId, sessionId) === 'focus'
  let seen = followedEdits.get(sessionId)
  if (!seen) {
    seen = new Set<string>()
    followedEdits.set(sessionId, seen)
    if (followedEdits.size > 500) {
      const oldest = followedEdits.keys().next().value
      if (oldest && oldest !== sessionId) followedEdits.delete(oldest)
    }
  }
  const target = decideFollowReveal({
    enabled,
    isActiveSession,
    paths: parsed.paths,
    seen,
    maxOpened: MAX_FOLLOWED_EDITS,
  })
  if (!target) return
  seen.add(target)
  // Gentle: no `important`, so a `file` reveal only lands when the editor grid is
  // already open (it never opens a closed panel or hides the conversation).
  autoReveal({ kind: 'file', sessionId, path: target })
}

/**
 * Agent-driven preview control: relay the `browser` command to the open
 * PreviewTab via the bus (not the store — it's a transient request). The tab runs
 * it against the probe and replies over the `preview-result` WS RPC.
 */
export function routePreviewCommand(
  sessionId: string,
  parsed: Extract<AgentStreamEvent, { type: 'preview.command' }>,
): void {
  previewControlBus.publish({ sessionId, commandId: parsed.commandId, command: parsed.command })
}

/**
 * Agent closed the preview (`browser action="close"`): close the session's
 * preview tab(s) via the inspector bus. Not gated on the panel being open (closing a
 * tab can't steal focus) and not routed through the store — the preview lives in the
 * inspector. With no `previewId`, the tabs the session itself opened close.
 */
export function routePreviewClosed(
  sessionId: string,
  parsed: Extract<AgentStreamEvent, { type: 'preview.closed' }>,
): void {
  // Clear the session's preview CONTENT — only in its workspace's Browser strip. Each workspace
  // has its own; scanning every strip let an agent close another chat's pages. The strip is
  // shared with the sub-sessions of that workspace, so a close that names no tab reaches only
  // what THIS session opened: a finished sub-agent's cleanup must not take its parent's pages.
  const previewStore = usePreviewStore.getState()
  const requested = parsed.previewIds ? new Set(parsed.previewIds) : null
  const closing: string[] = []
  for (const entry of previewStore.previewTabsBySession[workspaceOf(sessionId)] ?? []) {
    if (
      requested
        ? !requested.has(entry.previewId)
        : parsed.previewId
          ? entry.previewId !== parsed.previewId
          : entry.originSessionId !== sessionId
    )
      continue
    if (parsed.backgroundOnly && entry.userOpened) continue
    closing.push(entry.previewId)
  }
  if (closing.length) {
    previewStore.closeBrowserTabs(closing)
    closeNativePages(closing, 'Could not close the pages the agent opened')
  }
  // Closing an agent page does not close the chat's Browser tab itself.
}

// Terminal ids already adopted+revealed this page load. `terminal.opened` is
// live-only (never in the replay buffer), but the guard keeps a duplicate frame
// from re-stealing a tab the user closed within the same page session.
const revealedTerminals = new Set<string>()

/**
 * The agent spawned a PTY (`bash action:"open"` interactive terminal or a
 * `bash background:true` job pane): seed the live-PTY registry so transcript
 * cards render it alive immediately (no "Terminal closed" flash before the next
 * background-jobs poll), and adopt + reveal its terminal tab — the documented
 * auto-open. Push-driven on purpose: the poll's alt-screen policy only covers
 * full-screen apps that actually enter the alternate screen (`claude` does not).
 */
export function routeTerminalOpened(
  sessionId: string,
  parsed: Extract<AgentStreamEvent, { type: 'terminal.opened' }>,
): void {
  useLiveTerminalsStore.getState().noteOpened(parsed.terminalId)
  // The same on-screen rule as `revealPreview` (`openPolicy`): a pane a background chat opened used
  // to pull the person out of the chat they were reading, and it waits in its own chat's work strip
  // (Open). One a sibling conversation of this workspace opened joins it as a tab, unfocused.
  const policy = openPolicy(useChatStore.getState().activeSessionId, sessionId)
  if (policy === 'none') return
  if (revealedTerminals.has(parsed.terminalId)) return
  if (revealedTerminals.size > 500) revealedTerminals.clear()
  revealedTerminals.add(parsed.terminalId)
  terminalBus.openJob({
    terminalId: parsed.terminalId,
    sessionId,
    title: parsed.command ?? 'Terminal',
    reveal: policy === 'focus',
  })
}

/** A terminal exit is push-driven too: retire transcript actions immediately.
 *  The next registry poll remains the reconnect source of truth, but is no
 *  longer on the correctness path for disabling a dead PTY. */
export function routeTerminalFinished(
  sessionId: string,
  parsed: Extract<AgentStreamEvent, { type: 'terminal.finished' }>,
): void {
  useLiveTerminalsStore.getState().noteFinished(parsed.terminalId)
  // Its "Open preview" and takeover state die with it, not on the next backstop poll.
  forgetTerminalState(sessionId, parsed.terminalId)
}

/**
 * Open (or refresh) a live server preview in the inspector panel. The recording, the version
 * guard and the reveal live in `revealPreview`, shared with the click path that opens a preview
 * from a response — see that module for why the frame alone was not enough.
 */
export function routePreviewUpdated(
  sessionId: string,
  parsed: Extract<AgentStreamEvent, { type: 'preview.updated' }>,
): void {
  revealPreview(sessionId, {
    background: parsed.background,
    viewport: parsed.viewport,
    previewId: parsed.previewId ?? originOf(parsed.url),
    url: parsed.url,
    title: parsed.title,
    version: parsed.version,
    servedFile: parsed.servedFile,
    rootDir: parsed.rootDir,
    startCommand: parsed.startCommand,
    frameBlocked: parsed.frameBlocked,
  })
}
