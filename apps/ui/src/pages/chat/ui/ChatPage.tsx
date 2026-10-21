import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useSyncExternalStore,
  Suspense,
  lazy,
} from 'react'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { useLocation } from 'react-router'
import { useShallow } from 'zustand/react/shallow'

import { useChatStore, useHasHydrated } from '@/features/chat/model/store'
import { useExternalSessionTerminal } from '@/features/external-agents/model/useExternalSessionTerminal'
import { useDeadTerminalCleanup } from '@/features/terminal/model/useDeadTerminalCleanup'
import { useJobTerminal } from '@/features/chat/model/useJobTerminal'
import { useCodeSnippetOpener } from '@/features/chat/model/useCodeSnippetOpener'
import { useRoutedNavigation } from '@/shared/hooks/useRoutedNavigation'
import { useUiNavigation } from '@/shared/hooks/useUiNavigation'
import { isSectionId } from '@/shared/routing/routes'
import { StatusBar } from '@/features/chat/ui/StatusBar'
import { ChatSidebar } from '@/features/chat/ui/ChatSidebar'
import { useTheme } from '@/shared/theme/useTheme'
import { subscribeUiOverlay } from '@/shared/lib/uiOverlayBus'
import { SOURCES_OVERLAY_ID } from '@/features/chat/ui/sources/Sources.surface'
import { answerSourcesOfMessage } from '@/features/chat/model/sessionSources'
import { findSessionInState } from '@/features/chat/model/findSession'
import { useWorkspace } from '@/features/chat/model/useWorkspace'
import { toast } from '@/shared/lib/notify'
import { requireOpenChat } from '@/shared/lib/pageOpenChat'
import { inspector } from '@/shared/lib/inspectorBus'
import { useAddProjectFolder } from '@/features/chat/model/useAddProjectFolder'
import { WorkspaceShell } from '@/widgets/workspace-shell'
import { GridView } from '@/widgets/editor-grid'
import { useGridStore, hydrateGrid } from '@/features/workspace-grid/model'
import { useWorkspaceTabTransfer } from '@/widgets/editor-grid/model/useWorkspaceTabTransfer'
import { installBrowserPageWindowTransfers } from '@/widgets/editor-grid/model/browserPageWindowTransfer'
import { installBrowserPageOwnership } from '@/widgets/editor-grid/model/browserPageOwnership'
import { installWorkspaceDragPreviews } from '@/widgets/editor-grid/model/workspaceDragPreviews'
import { AttentionDialog } from '@/features/chat/ui/attention/AttentionDialog'
import { SetupAnnouncement } from '@/widgets/workspace-tips/ui/SetupAnnouncement'
import { FolderTree } from 'lucide-react'
import { discoverUi } from '@/shared/contrib/discover'
import { railSectionRegistry, railViewletRegistry } from '@/shared/contrib/uiContrib'
import { useSystemToggle } from '@/shared/hooks/useSystemToggle'
import { useIsMobile, isMobileViewport } from '@/shared/hooks/useIsMobile'
import { initialSidebarOpen, rememberSidebarOpen } from '../model/sidebarOpenState'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import { useUrlStoreSync } from '../model/useUrlStoreSync'
import { useRailActions } from '../model/useRailActions'
import { useEditorGridCommands } from '../model/useEditorGridCommands'
import { usePluginContributions, usePluginContributionsSync } from '../model/usePluginContributions'
import { useNewChatAction } from '../model/useNewChatAction'
import {
  useChatPageBuses,
  useMenuTerminalBuses,
  useWorkspaceBuses,
} from '../model/useChatPageBuses'
import { TitlebarContent } from './TitlebarContent'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { tauriFrontendLog } from '@/shared/lib/tauri'
import { restartDesktopApp } from '@/shared/lib/desktopRestart'
import { settingsTargetUri } from '@/shared/lib/settingsAnchors'
import { navigateUi } from '@/shared/lib/uiNavigation'
import {
  runtimeStatus,
  subscribeRuntimeStatus,
  type RuntimeStatus,
} from '@/shared/lib/runtimeReady'
import { capabilityResourceUri } from '@localixai/plugin-sdk/navigation'
import { WorkspaceConnectionStatus } from './WorkspaceConnectionStatus'
import { SurfaceErrorBoundary } from '@/shared/ui/SurfaceErrorBoundary'

// The Files rail is closed on the common chat startup path. Its tree, search,
// drag/drop, source-control decoration, and mutation graph should be paid for
// only when the user opens Explorer.
const FileTreeSidebar = lazy(() =>
  import('@/features/inspector/ui/FileTreeSidebar').then((module) => ({
    default: module.FileTreeSidebar,
  })),
)

// Search and switcher dialogs are interaction-only surfaces. Load each one on
// first open, then keep it mounted so closing animations and reopen latency stay
// identical to an eager surface after that first interaction.
const CommandPalette = lazy(() =>
  import('@/features/inspector/ui/CommandPalette').then((module) => ({
    default: module.CommandPalette,
  })),
)
const GlobalSearchPalette = lazy(() =>
  import('@/features/search/ui/GlobalSearchPalette').then((module) => ({
    default: module.GlobalSearchPalette,
  })),
)
const QuickOpen = lazy(() =>
  import('@/features/inspector/ui/QuickOpen').then((module) => ({
    default: module.QuickOpen,
  })),
)
const GoToSymbol = lazy(() =>
  import('@/features/inspector/ui/GoToSymbol').then((module) => ({
    default: module.GoToSymbol,
  })),
)
const WorkspaceSymbols = lazy(() =>
  import('@/features/inspector/ui/WorkspaceSymbols').then((module) => ({
    default: module.WorkspaceSymbols,
  })),
)
const SessionSwitcher = lazy(() =>
  import('@/features/chat/ui/SessionSwitcher').then((module) => ({
    default: module.SessionSwitcher,
  })),
)
const ProjectSwitcher = lazy(() =>
  import('@/features/chat/ui/ProjectSwitcher').then((module) => ({
    default: module.ProjectSwitcher,
  })),
)

// BEFORE PAINT, and deliberately so — this pair is the one startup sequence that
// cannot be staged onto idle (see `installWhenIdle` and the phases in RootLayout).
// `discoverUi()` registers rail sections and work-item KINDS, and `hydrateGrid()`
// filters the restored layout against that kind registry: a kind registered after
// hydration is a tab silently dropped from the user's saved layout. Module scope is
// what guarantees the order holds before React renders anything.
//
// Core subsystems register synchronously. Bundled plugin modules are imported only
// after the API confirms they are enabled. The expensive half of discovery — the
// ~80 colocated `*.surface` declarations, which feed nothing on the paint path — is
// already staged behind `whenUiSurfacesReady()` inside `discoverUi()`.
discoverUi()
// Restore core layout immediately, independently of backend availability. Unknown
// plugin kinds are retained during the cold activation phase and reconciled once
// the first authoritative plugin snapshot arrives.
hydrateGrid()

const NO_RUNTIME_STATUS = () => undefined

function useRuntimeStatus(): RuntimeStatus | undefined {
  return useSyncExternalStore(subscribeRuntimeStatus, runtimeStatus, NO_RUNTIME_STATUS)
}

export function ChatPage() {
  useEffect(() => installBrowserPageWindowTransfers(), [])
  useEffect(() => installBrowserPageOwnership(), [])
  useEffect(() => installWorkspaceDragPreviews(), [])
  const workspaceTransferReady = useWorkspaceTabTransfer()
  useDeadTerminalCleanup()
  const runtimeState = useRuntimeStatus()
  const {
    activeSessionId,
    selectSession,
    selectProject,
    createHomeDraft,
    createSession,
    deleteSession,
    togglePinSession,
  } = useChatStore(
    useShallow((s) => ({
      activeSessionId: s.activeSessionId,
      selectSession: s.selectSession,
      selectProject: s.selectProject,
      createHomeDraft: s.createHomeDraft,
      createSession: s.createSession,
      deleteSession: s.deleteSession,
      togglePinSession: s.togglePinSession,
    })),
  )

  const { sessionTitle, lspServers } = useChatStore(
    useShallow((state) => {
      const session = findSessionInState(state, state.activeSessionId)
      return {
        sessionTitle: session?.title ?? null,
        lspServers: session?.lspServers,
      }
    }),
  )
  const hasHydrated = useHasHydrated()
  const isMobile = useIsMobile()
  const nav = useRoutedNavigation()
  // Page-level navigation (the rail, the shell) acts on the chat this page has open.
  useExternalSessionTerminal(activeSessionId)
  const uiNavigation = useUiNavigation({ sessionId: activeSessionId })
  const { sessionId: routeSessionId, sectionId, projectId: routeProjectId, isLegacyRoute } = nav
  const routePathname = useLocation().pathname
  // A neutral landing that mints a fresh GLOBAL draft: the bare index ("/") OR
  // "/global" with no session. We do NOT resurrect the last chat there.
  const isHomeRoute =
    !isLegacyRoute &&
    routeProjectId === null &&
    !routeSessionId &&
    (routePathname === '/' || routePathname.startsWith('/global'))
  const { enabledPluginNames, plugins, pluginsPending, thirdPartyViewsV, contribScope } =
    usePluginContributions({ routeProjectId, onHomeRoute: isHomeRoute })
  const pluginCategories = useMemo(
    () => new Map(plugins.map((plugin) => [plugin.name, plugin.category])),
    [plugins],
  )
  // Wire the "Open as .sql" action on SQL code blocks in the transcript.
  useCodeSnippetOpener()
  // Restore the last open/closed state on desktop; on mobile the sidebar is a
  // full overlay, so auto-reopening it on load would hide the chat.
  // A first run starts collapsed (`sidebarOpenState.ts`).
  const [sidebarOpen, setSidebarOpen] = useState(() => initialSidebarOpen(isMobileViewport()))
  useEffect(() => {
    if (isMobile) return
    rememberSidebarOpen(sidebarOpen)
  }, [sidebarOpen, isMobile])

  const { resolvedTheme } = useTheme()
  const workspace = useWorkspace()
  useChatPageBuses({ hasHydrated })
  // Host-level "keep this machine awake" control (rail toggle below).
  const keepAwake = useSystemToggle('keep-awake', hasHydrated)
  const [confirmKeepAwake, setConfirmKeepAwake] = useState(false)

  const {
    commandPalette,
    setCommandPalette,
    quickOpen,
    setQuickOpen,
    sessionSwitcher,
    setSessionSwitcher,
    projectSwitcher,
    setProjectSwitcher,
    goToSymbol,
    setGoToSymbol,
    workspaceSymbols,
    setWorkspaceSymbols,
    globalSearch,
    setGlobalSearch,
    commandPaletteMounted,
    quickOpenMounted,
    sessionSwitcherMounted,
    projectSwitcherMounted,
    goToSymbolMounted,
    workspaceSymbolsMounted,
    globalSearchMounted,
    closeFocusedTab,
    cycleFocusedTab,
    focusAdjacentGroup,
    openTerminalTab,
    reopenClosedTab,
    startNewChatRef,
    toggleMaximizeFocused,
    toggleSidebar,
  } = useEditorGridCommands({
    isMobile,
    setSidebarOpen,
    openSessionId: activeSessionId,
  })
  // Native File/Project menu → "Open Folder…" reuses the shared add-folder flow.
  const addProjectFolder = useAddProjectFolder()
  // Sources is intentionally not an overlay anymore. Palette and agent navigation still enter
  // through the stable overlay-shaped URI, but resolve into the same flat Activity work item used
  // by message actions. This keeps Chat visible and removes the scrim-only flash failure mode.
  // A request that names its conversation (the button inside a chat pane, an agent) shows THAT
  // one. One that names none comes from a page-level entry (the palette, `/open`) and acts on the
  // chat this page has open — given explicitly, never re-read from the store at fire time.
  useEffect(
    () =>
      subscribeUiOverlay(SOURCES_OVERLAY_ID, (params) => {
        const state = useChatStore.getState()
        const requestedSession =
          typeof params.session === 'string' && params.session ? params.session : null
        const sessionId = requestedSession ?? activeSessionId
        const session = findSessionInState(state, sessionId)
        if (!sessionId || !session) {
          toast.info('Open a conversation to view its sources')
          return
        }

        const requestedMessage =
          typeof params.message === 'string' && params.message ? params.message : null
        const requestedExists =
          requestedMessage !== null &&
          session.messages.some((message) => message.id === requestedMessage)
        const fallbackMessage = [...session.messages]
          .reverse()
          .find((message) => answerSourcesOfMessage(message).length > 0)
        const messageId = requestedExists ? requestedMessage : fallbackMessage?.id

        if (!messageId) {
          toast.info('No consulted sources in this conversation yet')
          return
        }
        inspector.openMessageReplay(sessionId, messageId, 'sources')
      }),
    [activeSessionId],
  )

  // The URL is the single source of truth for navigation. Navigators write to
  // it; the effects below sync the Zustand data store FROM the URL (one-way),
  // plus a single normalization redirect that stamps the URL so it always names
  // the active session/project.
  // Clicking a background job anywhere (sidebar, switcher) reveals its terminal
  // pane instead of navigating into a read-only sub-session.
  const { openIfJobSession } = useJobTerminal()
  const activeSectionId = sectionId
  const capabilityScope = routeProjectId ?? ''

  const switchSection = useCallback(
    // Accept any core section id OR any id contributed through the open rail-section
    // registry (subsystem sidebars register themselves) — core names no subsystem.
    (id: string | null) => nav.openSection(id != null && isSectionId(id) ? id : null),
    [nav],
  )

  useWorkspaceBuses({
    activeSessionId,
    sessionTitle,
    setSidebarOpen,
    switchSection,
    goToSession: nav.goToSession,
  })

  // URL is the single source of truth for navigation: navigators write to it and
  // useUrlStoreSync syncs the Zustand data store FROM the URL (one-way), plus the
  // normalization/legacy/home redirects and per-scope section + sidebar memory.
  const promptDeepLink = new URLSearchParams(useLocation().search).get('prompt')
  useUrlStoreSync({
    hasHydrated,
    nav,
    routeSessionId,
    sectionId,
    routeProjectId,
    isLegacyRoute,
    isHomeRoute,
    isColdIndex: routePathname === '/',
    activeSessionId,
    isMobile,
    sidebarOpen,
    setSidebarOpen,
    promptDeepLink,
    createHomeDraft,
    selectProject,
    selectSession,
    createSession,
  })

  // Problems is opened from the bottom StatusBar's diagnostics indicator (which
  // already shows the error/warning counts) — as a grid WorkItem, one per chat: the
  // open chat's, whose diagnostics that indicator counts. With none open it says so.
  const openProblems = useCallback(() => {
    const sessionId = requireOpenChat(activeSessionId)
    if (!sessionId) return
    useGridStore
      .getState()
      .openItem({ kind: 'problems', id: 'problems', title: 'Problems', scope: sessionId })
  }, [activeSessionId])

  const { creatingChat, paletteCommands, startNewChat, startNewChatWith } = useNewChatAction({
    openSessionId: activeSessionId,
    createSession,
    cycleFocusedTab,
    enabledPluginNames,
    focusAdjacentGroup,
    isMobile,
    nav,
    openProblems,
    openTerminalTab,
    reopenClosedTab,
    routeProjectId,
    setGlobalSearch,
    setGoToSymbol,
    setProjectSwitcher,
    setQuickOpen,
    setSessionSwitcher,
    setSidebarOpen,
    setWorkspaceSymbols,
    startNewChatRef,
    switchSection,
    thirdPartyViewsVersion: thirdPartyViewsV,
    toggleSidebar,
    toggleMaximizeFocused,
  })

  useMenuTerminalBuses({
    activeSessionId,
    addProjectFolder,
    closeFocusedTab,
    openTerminalTab,
    setCommandPalette,
    setSidebarOpen,
    switchSection,
    toggleSidebar,
  })

  const pluginViews = usePluginContributionsSync({
    hasHydrated,
    routeProjectId: contribScope,
    thirdPartyViewsV,
  })
  const railActions = useRailActions({
    pluginViews,
    capabilityScope,
    openSessionId: activeSessionId,
    keepAwake,
    isMobile,
    setSidebarOpen,
    setConfirmKeepAwake,
  })

  // Rail sections contributed by bundled subsystems via the open registry. Mapped
  // to the shell's RailSection shape; workbench sections default into the "…"
  // overflow, matching the core db entry.
  const contributedRailSections = useMemo(() => {
    void enabledPluginNames
    return railSectionRegistry.list().map((s) => ({
      id: s.id,
      icon: <s.Icon className="size-4.5" />,
      label: s.title,
      content: <s.Sidebar />,
      defaultArea: 'overflow' as const,
      plugin: true,
      pluginName: s.pluginName,
      resourceUri: capabilityResourceUri({
        kind: 'view',
        id: s.id,
        scope: capabilityScope,
        label: s.title,
        description: `View contributed by ${s.pluginName || 'a plugin'}`,
        enabled: true,
      }),
    }))
  }, [capabilityScope, enabledPluginNames])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      tauriFrontendLog('startup', `shell.paint epochMs=${Date.now()} ui=${__UI_BUILD__}`)
    })
    return () => cancelAnimationFrame(frame)
  }, [])
  useEffect(() => {
    if (hasHydrated) tauriFrontendLog('startup', `workspace.ready epochMs=${Date.now()}`)
  }, [hasHydrated])

  return (
    <WorkspaceShell
      isMobile={isMobile}
      sidebarOpen={sidebarOpen}
      activeSectionId={activeSectionId}
      onSectionChange={switchSection}
      sidebarContent={
        hasHydrated ? (
          <ChatSidebar
            activeSessionId={activeSessionId}
            onSelect={(id, opts) => {
              if (openIfJobSession(id)) return
              // Re-clicking the ALREADY-active session re-opens its chat tab if the
              // user had closed it (the URL doesn't change, so the seed effect won't
              // fire). A different session navigates as usual.
              if (id === activeSessionId) useGridStore.getState().reopenChat(id)
              else nav.goToSession(id, opts)
              if (isMobile) setSidebarOpen(false)
            }}
            onDelete={(id) => {
              const wasActive = id === activeSessionId
              deleteSession(id)
                .then(() => {
                  // Deleting the FOCUSED session lands on the neutral home (a blank
                  // chat) — never auto-jump into another existing conversation.
                  if (wasActive) nav.goReplace('/')
                })
                .catch((e: unknown) =>
                  toast.error('Could not delete the conversation', {
                    description: errorMessage(e, '') || undefined,
                  }),
                )
            }}
            onTogglePin={(id) => {
              void togglePinSession(id)
            }}
            onOpenScopeSwitcher={() => setProjectSwitcher(true)}
            onNewChat={startNewChatWith}
          />
        ) : undefined
      }
      railActions={railActions}
      pluginsPending={pluginsPending}
      pluginCategories={pluginCategories}
      capabilitiesManageUri={settingsTargetUri({ tab: 'plugins', scope: capabilityScope })}
      onNavigateUi={(uri) => {
        navigateUi(uri, uiNavigation)
      }}
      createChatBusy={!hasHydrated || creatingChat}
      railSections={
        hasHydrated
          ? [
              {
                id: 'files',
                icon: <FolderTree className="size-4.5" />,
                label: 'Files',
                content: (
                  <Suspense fallback={<LoadingHint className="min-h-0 flex-1 text-xs" />}>
                    <FileTreeSidebar />
                  </Suspense>
                ),
                customizable: true,
                defaultArea: 'top',
              },
              // Subsystem rail sections (the database / container / cluster workbenches) come
              // from the open rail-section registry, populated by generic contrib discovery
              // (see `discoverUi`). Workbench sections start in the "…" overflow.
              ...contributedRailSections,
            ]
          : []
      }
      onOpenSidebar={() => setSidebarOpen(true)}
      onCloseSidebar={() => setSidebarOpen(false)}
      // Rail, shortcut, palette, breadcrumb and sidebar all enter the same page-owned action.
      // Their scope/participant/draft differences are data (`ConversationStartStrategy`).
      onCreateChat={hasHydrated ? startNewChat : () => undefined}
      titlebarContent={<TitlebarContent />}
      headerStatus={
        <WorkspaceConnectionStatus
          hasHydrated={hasHydrated}
          error={workspace.error}
          runtimeState={runtimeState}
          onRetry={() => {
            if (runtimeState === 'error') {
              restartDesktopApp()
              return
            }
            void workspace.mutate()
          }}
        />
      }
      statusSessionId={activeSessionId}
      footer={<StatusBar lspServers={lspServers} onOpenProblems={openProblems} />}
    >
      <Suspense fallback={<LoadingHint>Opening workspace…</LoadingHint>}>
        {workspaceTransferReady && <GridView resolvedTheme={resolvedTheme} isMobile={isMobile} />}
      </Suspense>
      {hasHydrated && (
        <>
          {/* Always-mounted subsystem lifecycle components contributed via the open
          registries (render null) — core mounts them generically, naming none. A
          rail SECTION's Mount (e.g. k8s port-forward cleanup) and a rail VIEWLET's
          Mount components both land here. */}
          {/* Each behind its own boundary. These are ALWAYS mounted, so a plugin that throws
              here is strictly worse than one that throws in a tab: without containment it takes
              the workspace down at composition, on every start, with no tab to close. The
              fallback renders nothing visible for a render-null component — the console name and
              the surviving app are the signal. */}
          {railSectionRegistry.list().flatMap((s) =>
            s.Mount
              ? [
                  <SurfaceErrorBoundary
                    key={`mount:${s.id}`}
                    surface={`The ${s.id} background`}
                    fallback="silent"
                  >
                    <s.Mount />
                  </SurfaceErrorBoundary>,
                ]
              : [],
          )}
          {railViewletRegistry.list().map((v) =>
            v.Mount ? (
              <SurfaceErrorBoundary
                key={`vmount:${v.kind}`}
                surface={`The ${v.kind} background`}
                fallback="silent"
              >
                <v.Mount />
              </SurfaceErrorBoundary>
            ) : null,
          )}
          {commandPaletteMounted && (
            <Suspense fallback={null}>
              <CommandPalette
                sessionId={activeSessionId}
                open={commandPalette}
                onOpenChange={setCommandPalette}
                commands={paletteCommands}
              />
            </Suspense>
          )}
          {globalSearchMounted && (
            <Suspense fallback={null}>
              <GlobalSearchPalette
                sessionId={activeSessionId}
                open={globalSearch}
                onOpenChange={setGlobalSearch}
                commands={paletteCommands}
              />
            </Suspense>
          )}
          {quickOpenMounted && (
            <Suspense fallback={null}>
              <QuickOpen sessionId={activeSessionId} open={quickOpen} onOpenChange={setQuickOpen} />
            </Suspense>
          )}
          {goToSymbolMounted && (
            <Suspense fallback={null}>
              <GoToSymbol
                sessionId={activeSessionId}
                open={goToSymbol}
                onOpenChange={setGoToSymbol}
              />
            </Suspense>
          )}
          {workspaceSymbolsMounted && (
            <Suspense fallback={null}>
              <WorkspaceSymbols
                sessionId={activeSessionId}
                open={workspaceSymbols}
                onOpenChange={setWorkspaceSymbols}
              />
            </Suspense>
          )}
          {sessionSwitcherMounted && (
            <Suspense fallback={null}>
              <SessionSwitcher
                open={sessionSwitcher}
                onOpenChange={setSessionSwitcher}
                activeSessionId={activeSessionId}
                onSelect={(id) => {
                  if (openIfJobSession(id)) return
                  const proj = useChatStore
                    .getState()
                    .allSessions.find((s) => s.id === id)?.projectId
                  nav.goToSession(id, proj ? { project: proj } : undefined)
                  if (isMobile) setSidebarOpen(false)
                }}
              />
            </Suspense>
          )}
          {projectSwitcherMounted && (
            <Suspense fallback={null}>
              <ProjectSwitcher open={projectSwitcher} onOpenChange={setProjectSwitcher} />
            </Suspense>
          )}
          {/* Route-independent: what waits on the person in a chat they are not viewing — a
          request, a plan, a mention — raised one at a time from the shared attention roster. */}
          <AttentionDialog />
          {/* Setup over the chat the launch opened: on a first run, and from the palette. */}
          <SetupAnnouncement />
          <ConfirmDialog
            open={confirmKeepAwake}
            variant="default"
            title={
              keepAwake.state?.enabled
                ? 'Let this computer sleep again?'
                : 'Keep this computer awake?'
            }
            description={
              keepAwake.state?.enabled
                ? 'LocalixAI will stop holding the system awake. A long agent run or channel session could be interrupted if the machine sleeps.'
                : 'Prevents this computer from sleeping while LocalixAI runs, so long agent runs and external channel sessions aren’t interrupted. Turn it off any time from the same button.'
            }
            confirmLabel={keepAwake.state?.enabled ? 'Allow sleep' : 'Keep awake'}
            onConfirm={() => {
              void keepAwake.toggle()
              setConfirmKeepAwake(false)
            }}
            onClose={() => setConfirmKeepAwake(false)}
          />
        </>
      )}
    </WorkspaceShell>
  )
}
