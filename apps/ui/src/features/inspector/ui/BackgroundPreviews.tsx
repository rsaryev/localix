import { useEffect } from 'react'
import { eventSocket } from '@/shared/api/eventSocket'
import { isDesktop } from '@localixai/kit/environment'
import { routePreviewCommand, routePreviewUpdated } from '../model/sessionPreviewRouters'
import { usePreviewStore } from '../model/previewStore'
import { previewHostKey, usePreviewHosts } from '../model/previewHosts'
import type { PreviewEntry, PreviewsBySession } from '../model/preview'
import { PreviewTab } from './PreviewTab'
import { browserEngine, hostsInFrame } from '../model/browserUrl'
import { closeNativePages } from '../model/nativePages'
import {
  forgetAgentActivity,
  leftByFailedRun,
  leftIdle,
  nativePageOnScreen,
} from '../model/agentPageCleanup'
import { nativePageRendererLease } from '@/shared/lib/nativePageRendererLease'
import { workspaceOf } from '@/shared/lib/workspaceOf'
import { useNativeBrowserAgent } from './useNativeBrowserAgent'
import { useNativePageSync } from './useNativePageSync'
import { useUnknownTabReply } from './useUnknownTabReply'

interface BackgroundPreviewHost {
  sessionId: string
  entry: PreviewEntry
  key: string
}

/** Every live preview needs a host: dropping later entries makes the `Browser` tool unreachable. */
export function selectBackgroundPreviewHosts(
  tabs: PreviewsBySession,
  live: Record<string, boolean>,
  foreground: Record<string, number>,
): BackgroundPreviewHost[] {
  return Object.entries(tabs)
    .flatMap(([sessionId, entries]) =>
      entries.map((entry) => ({
        sessionId,
        entry,
        key: previewHostKey(sessionId, entry.previewId),
      })),
    )
    .filter(({ key, entry }) => hostsInFrame(entry) && live[key] && !foreground[key])
}

/**
 * A run ended: its workspace's off-screen tabs give up their renderers. The tabs stay in the strip
 * and come back when shown, or when the agent commands one again (`routePreviewCommand`). A tab
 * still mounted in a hidden panel is not off screen in this sense: it holds its page.
 */
export function releaseBackgroundPreviews(sessionId: string): void {
  const workspace = workspaceOf(sessionId)
  usePreviewHosts.getState().releaseWorkspace(workspace)
  const { foreground } = usePreviewHosts.getState()
  const native = (usePreviewStore.getState().previewTabsBySession[workspace] ?? [])
    .filter(
      (entry) =>
        browserEngine(entry) === 'native' &&
        !foreground[previewHostKey(sessionId, entry.previewId)] &&
        // A tab in a panel that is mounted but not active keeps its page: it shows it again by
        // framing it, never by reopening it, so a page closed under it would come back blank.
        !nativePageRendererLease.mounted(entry.previewId),
    )
    .map((entry) => entry.previewId)
  closeNativePages(native, 'Could not release background browser pages')
}

/** Close agent pages as the agent's own `close` would: the tab and its native page. */
function closeAgentPages(previewIds: string[]): void {
  if (!previewIds.length) return
  usePreviewStore.getState().closeBrowserTabs(previewIds)
  closeNativePages(previewIds, 'Could not close the pages an agent left behind')
  forgetAgentActivity(previewIds)
}

/** A run failed: the off-screen pages it opened close (`agentPageCleanup.ts`). */
export function closePagesOfFailedRun(sessionId: string): void {
  const entries = usePreviewStore.getState().previewTabsBySession[workspaceOf(sessionId)] ?? []
  closeAgentPages(leftByFailedRun({ entries, sessionId, onScreen: nativePageOnScreen }))
}

/** How often the idle backstop looks for agent pages nothing drives any more. */
const IDLE_SWEEP_MS = 60_000
/** Sessions with a run under way, from the run events this host hears. */
const running = new Set<string>()

/** Host the previews an agent is using off screen, independently of the selected conversation. */
export default function BackgroundPreviews() {
  const tabs = usePreviewStore((s) => s.previewTabsBySession)
  useNativeBrowserAgent(tabs)
  useNativePageSync()
  useUnknownTabReply()
  useEffect(() => {
    if (!isDesktop) return
    return eventSocket.onSessionEvent((sessionId, event) => {
      if (event.type === 'preview.command') routePreviewCommand(sessionId, event)
      if (event.type === 'preview.updated') routePreviewUpdated(sessionId, event)
    })
  }, [])
  useEffect(
    () =>
      eventSocket.onSessionEvent((sessionId, event) => {
        if (event.type === 'run.started') running.add(sessionId)
        if (event.type === 'run.completed' || event.type === 'run.failed') {
          running.delete(sessionId)
          usePreviewStore.getState().resetAgentViewports(sessionId)
          if (event.type === 'run.failed') closePagesOfFailedRun(sessionId)
          releaseBackgroundPreviews(sessionId)
        }
      }),
    [],
  )
  // The backstop: an off-screen agent page nothing has driven for a while closes, whatever ended
  // its run (a run that completed may still leave its page running unseen).
  useEffect(() => {
    if (!isDesktop) return
    const timer = setInterval(() => {
      const entries = Object.values(usePreviewStore.getState().previewTabsBySession).flat()
      closeAgentPages(
        leftIdle({
          entries,
          now: Date.now(),
          onScreen: nativePageOnScreen,
          running: (sessionId) => running.has(sessionId),
        }),
      )
    }, IDLE_SWEEP_MS)
    return () => clearInterval(timer)
  }, [])
  const live = usePreviewHosts((s) => s.live)
  const foreground = usePreviewHosts((s) => s.foreground)
  const hosts = selectBackgroundPreviewHosts(tabs, live, foreground)
  return (
    <>
      {hosts.map(({ sessionId, entry, key }) => (
        <div
          key={key}
          aria-hidden="true"
          style={{
            position: 'fixed',
            display: 'flex',
            left: -10000,
            top: 0,
            width: 1280,
            height: 800,
            pointerEvents: 'none',
          }}
        >
          <PreviewTab key={entry.version} {...entry} sessionId={sessionId} backgroundHost />
        </div>
      ))}
    </>
  )
}
