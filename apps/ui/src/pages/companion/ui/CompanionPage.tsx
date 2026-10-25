import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Paperclip } from 'lucide-react'
import { DROP_TARGET_OVERLAY_ACTIVE } from '@localixai/kit/drop-target'
import { useComposerDropzone } from '@/entities/chat/ui/prompt-input/useComposerDropzone'
import { Button } from '@localixai/kit/button'
import { useTheme } from '@/shared/theme/useTheme'
import { useFontFamily } from '@/features/settings/model/useFontFamily'
import { startSettingsBootstrap } from '@/features/settings/model/settingsBootstrap'
import { useSettingsStore } from '@/shared/lib/user-settings/settingsStore'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { openCompanionSession } from '@/shared/lib/companionWindow'
import { useCompanionState } from '@/features/companion/model/useCompanionState'
import { useIsland } from '@/features/companion/model/useIsland'
import { useIslandGeometry } from '@/features/companion/model/useIslandGeometry'
import { useIslandContentHeight } from '@/features/companion/model/useIslandContentHeight'
import { useQuickChat } from '@/features/companion/model/useQuickChat'
import { useIslandOverlays } from '@/features/companion/model/useIslandOverlays'
import { useIslandContributions } from '@/features/companion/model/useIslandContributions'
import { useWorkspaceFocus } from '@/features/companion/model/useWorkspaceFocus'
import {
  companionRoster,
  islandNotices,
  islandRequests,
  nextRequest,
  pendingRequest,
} from '@/features/companion/model/roster'
import { islandStyle } from '@/features/companion/model/geometry'
import { inDeadProject } from '@/features/companion/model/islandConversation'
import { IslandAttention } from '@/features/companion/ui/IslandAttention'
import { IslandToolbar } from '@/features/companion/ui/IslandToolbar'
import { IslandNotice } from '@/features/companion/ui/IslandNotice'
const QuickChat = lazy(() =>
  import('@/features/companion/ui/QuickChat').then(({ QuickChat }) => ({ default: QuickChat })),
)
import '@/features/companion/ui/island.css'

export function CompanionPage() {
  useTheme()
  useFontFamily()
  const loadSettings = useSettingsStore((state) => state.loadFromBackend)
  const state = useCompanionState()
  const roster = useMemo(
    () => companionRoster(state.sessions, state.items),
    [state.sessions, state.items],
  )
  const geometry = useIslandGeometry()
  const content = useIslandContentHeight(geometry.notchHeight)
  const requests = islandRequests(roster.waiting)
  const notices = islandNotices(roster.waiting)
  // A focused workspace already shows its requests; the folded island does not repeat them.
  const workspaceFocused = useWorkspaceFocus()
  // The quick conversation is a session too, so its runs count as work here.
  const quiet = roster.working.length === 0 && (roster.waiting.length === 0 || workspaceFocused)
  const island = useIsland(roster.waiting, {
    height: content.height,
    nativePointer: geometry.nativePointer,
    quiet,
    holdAttention: workspaceFocused,
  })
  const chat = useQuickChat(island.expanded)
  useIslandOverlays(island.expanded)
  useIslandContributions(chat.session?.projectId)
  const { prepare, leave } = chat
  // A folder removed in the workspace takes its conversation with it, silently, like a dead
  // project route in the main app; opening the island then lands on the default project.
  const deadProject = inDeadProject(
    state.projectsLoaded ? state.projects : null,
    chat.session?.projectId,
  )
  useEffect(() => {
    if (deadProject) leave()
  }, [deadProject, leave])
  const [actionError, setActionError] = useState<string | null>(null)
  // Opening validates the remembered conversation; a dropped one lands on a valid conversation.
  useEffect(() => {
    if (island.expanded) void prepare().catch(() => {})
  }, [island.expanded, prepare, chat.sessionId])
  const { dispatch, collapse } = island
  const dropzone = useComposerDropzone({
    onAddFiles: (files) => void chat.files.addFiles(files),
    attachEnabled: Boolean(chat.connections.activeConnection && chat.model),
  })
  const pending = pendingRequest(requests, island.selectedKey, chat.session?.id)
  const busy = chat.running || roster.working.length > 0
  const waiting = (Boolean(pending) || notices.length > 0) && (island.expanded || !workspaceFocused)
  // The folded edge stays soft at rest and brightens while agents work or wait.
  const status = waiting ? 'Waiting for you' : busy ? 'Working' : ''
  useEffect(() => startSettingsBootstrap(loadSettings), [loadSettings])
  useEffect(() => {
    document.documentElement.dataset.companion = 'true'
    void platformCapabilities()
      .desktop.invoker()?.('companion_ready')
      .catch(() => setActionError('Could not show the island.'))
    return () => {
      delete document.documentElement.dataset.companion
    }
  }, [])
  // Keep Escape available while a lazy composer or request is still loading. The mounted input
  // takes focus itself as soon as it is ready.
  const root = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!island.expanded) return
    const frame = requestAnimationFrame(() => {
      if (!root.current?.contains(document.activeElement))
        root.current?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [island.expanded])
  const alert =
    actionError ||
    (chat.startFailed ? 'Could not start a conversation.' : null) ||
    (!state.loading && !state.connected ? 'Reconnecting… Your draft is saved.' : null) ||
    (state.error ? 'Could not refresh. Showing the last update.' : null)
  const openSession = (id: string) => {
    setActionError(null)
    void openCompanionSession(id).catch(() => setActionError('Could not open the conversation.'))
  }
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- File-drop boundary and Escape-to-fold for the whole island; other keys belong to the shared composer.
    <main
      ref={root}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault()
          collapse()
        } else if (event.key !== 'Escape') {
          dispatch({ type: 'interact' })
        }
      }}
      aria-label="Agent island"
      onDragEnter={(event) => {
        if (!event.defaultPrevented) dropzone.handleDragEnter(event)
        if (Array.from(event.dataTransfer.types).includes('Files')) dispatch({ type: 'hover' })
      }}
      onDragOver={(event) => {
        if (!event.defaultPrevented) dropzone.handleDragOver(event)
      }}
      onDragLeave={dropzone.handleDragLeave}
      onDrop={(event) => {
        if (event.defaultPrevented) return
        dropzone.handleDrop(event)
        dispatch({ type: 'back' })
      }}
      data-expanded={island.expanded}
      data-preview={island.preview}
      data-quiet={quiet}
      data-notch={geometry.hasNotch}
      data-native-material={geometry.nativeMaterial}
      className="lx-agent-island outline-none"
      style={islandStyle(geometry.geometry, content.height)}
    >
      <div className="lx-island-material lx-floating-surface" aria-hidden />
      <div className="lx-island-outline" aria-hidden>
        <span
          className="lx-island-edge"
          // Even a quiet resting island keeps a faint idle glint so it stays discoverable.
          data-active={!island.expanded}
          data-mode={waiting ? 'waiting' : busy ? 'working' : 'idle'}
        >
          <span className="lx-island-edge-glow" />
          <span className="lx-island-edge-rim" />
        </span>
      </div>
      <Button
        variant="ghost"
        className="lx-island-resting justify-center p-0"
        aria-label="Expand agent island"
        aria-expanded={island.expanded}
        onClick={() => island.dispatch({ type: 'activate' })}
        onPointerEnter={island.onPointerEnter}
        onPointerLeave={island.onPointerLeave}
      />
      <span role="status" className="sr-only">
        {status}
      </span>
      <div
        className="lx-island-open"
        inert={!island.expanded}
        onPointerDown={() => dispatch({ type: 'interact' })}
        onInput={() => dispatch({ type: 'interact' })}
        onPointerEnter={island.onPointerEnter}
        onPointerLeave={island.onPointerLeave}
      >
        {dropzone.dragging && (
          <div
            role="status"
            className={`pointer-events-none absolute inset-3 z-(--z-drag-overlay) flex items-center justify-center gap-2 rounded-(--radius-composer) text-sm ${DROP_TARGET_OVERLAY_ACTIVE}`}
          >
            <Paperclip className="size-4" />
            Drop to attach
          </div>
        )}
        <div ref={content.ref} className="lx-island-content flex flex-col gap-2 px-3 pt-2 pb-3">
          {island.expanded && (
            <IslandToolbar
              chat={chat}
              projects={state.projects}
              sessions={state.sessions}
              onRefresh={state.refresh}
            />
          )}
          {alert && (
            <div role="alert" className="lx-island-alert">
              <span className="min-w-0 flex-1">{alert}</span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setActionError(null)
                  state.refresh()
                  if (chat.startFailed || !chat.sessionId) void chat.retry().catch(() => {})
                }}
              >
                Retry
              </Button>
            </div>
          )}
          {/* Content keeps its intrinsic height; the island scrolls instead of squeezing it. */}
          <div className="shrink-0">
            <Suspense fallback={null}>
              <QuickChat
                chat={chat}
                dropzone={dropzone}
                focused={island.expanded}
                attentionActive={Boolean(pending)}
                onOpen={openSession}
                notice={
                  notices[0] && (
                    <IslandNotice
                      item={notices[0]}
                      count={notices.length}
                      onOpen={() => openSession(notices[0]!.sessionId)}
                    />
                  )
                }
                attention={
                  pending && (
                    <IslandAttention
                      key={pending.key}
                      item={pending}
                      session={state.sessions.find((session) => session.id === pending.sessionId)}
                      active={island.expanded}
                      count={requests.length}
                      onNext={() => {
                        const next = nextRequest(requests, pending.key)
                        if (next) dispatch({ type: 'select', key: next.key })
                      }}
                      onOpen={() => openSession(pending.sessionId)}
                      onResolved={() => {
                        dispatch({ type: 'resolved', key: pending.key })
                        state.refresh()
                      }}
                    />
                  )
                }
              />
            </Suspense>
          </div>
        </div>
      </div>
    </main>
  )
}
