import { useEffect, useRef, useState } from 'react'
import { useChatStore } from '@/features/chat/model/store'
import {
  loadScopeLocation,
  rememberScopeSection,
  rememberScopeSidebarOpen,
} from '@/features/chat/model/workspaceLocation'
import {
  forgetLastWorkspace,
  holdLastWorkspace,
  loadLastWorkspace,
} from '@/features/chat/model/persistence'
import { LAUNCH_RESTORE_WAIT_MS, resolveLaunchRestore } from '@/features/chat/model/launchRestore'
import { findSessionInState } from '@/features/chat/model/findSession'
import { scopePath } from '@/shared/routing/routes'
import { composerBus } from '@/shared/lib/composerBus'
import { startStartupRetry } from '@/shared/lib/startupRetry'
import type { useRoutedNavigation } from '@/shared/hooks/useRoutedNavigation'
import { isMissingRoutedSessionError, shouldLoadRoutedSession } from './urlSessionSelection'
import { scopedNewConversation } from '@/features/chat/model/conversationStartStrategy'

type Nav = ReturnType<typeof useRoutedNavigation>
type ChatState = ReturnType<typeof useChatStore.getState>

interface UrlStoreSyncOptions {
  hasHydrated: boolean
  nav: Nav
  routeSessionId: string | null
  sectionId: string | null
  routeProjectId: string | null
  isLegacyRoute: boolean
  isHomeRoute: boolean
  /** The URL is the bare index (`/`) — a true cold launch, NOT `/global`. Only this
   *  triggers the launch-time "reopen the last project workspace" restore. */
  isColdIndex: boolean
  activeSessionId: string | null
  isMobile: boolean
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  promptDeepLink: string | null
  createHomeDraft: ChatState['createHomeDraft']
  selectProject: ChatState['selectProject']
  selectSession: ChatState['selectSession']
  createSession: ChatState['createSession']
}

/**
 * URL↔store synchronization for the chat workspace. The URL is the single source
 * of truth for navigation; navigators write to it and these effects sync the
 * Zustand data store FROM the URL (one-way), plus normalization/legacy/home
 * redirects and per-scope section+sidebar memory.
 *
 * Extracted verbatim from ChatPage (byte-identical effect order, deps, and ref
 * semantics) so the page body reads as layout, not routing plumbing. Sibling of
 * {@link useMenuCommands}/{@link useTerminalBusWiring}.
 */
export function useUrlStoreSync(opts: UrlStoreSyncOptions): void {
  const {
    hasHydrated,
    nav,
    routeSessionId,
    sectionId,
    routeProjectId,
    isLegacyRoute,
    isHomeRoute,
    isColdIndex,
    activeSessionId,
    isMobile,
    sidebarOpen,
    setSidebarOpen,
    promptDeepLink,
    createHomeDraft,
    selectProject,
    selectSession,
    createSession,
  } = opts
  const goReplace = nav.goReplace

  // One-time normalization after hydration: when the URL is underspecified
  // (root `/` or `/chat` without a session), stamp the store's remembered
  // session + project into the URL so the URL — not localStorage — becomes the
  // source of truth. We then skip the matching sync pass so the absent project
  // isn't misread as an explicit "clear".
  const normalized = useRef(false)
  const skipNextSync = useRef(false)
  useEffect(() => {
    if (!hasHydrated || normalized.current) return
    normalized.current = true
    // Home is a neutral landing — handled by the dedicated home-clear effect
    // below, never the remembered-session redirect.
    if (isHomeRoute || isLegacyRoute) return
    const { activeSessionId: sid, activeProjectId: pid } = useChatStore.getState()
    if (!routeSessionId && sid && pid) {
      skipNextSync.current = true
      nav.goReplace(scopePath(pid, sid))
    }
  }, [hasHydrated, routeSessionId, nav, isHomeRoute, isLegacyRoute])

  // Legacy back-compat: an old bare `/chat/:id` link carries no scope. Resolve
  // the session's project and redirect to the hierarchical scoped URL. A bare
  // `/chat` with no session falls back to the neutral landing.
  const legacyRedirecting = useRef(false)
  useEffect(() => {
    if (!hasHydrated || !isLegacyRoute || legacyRedirecting.current) return
    legacyRedirecting.current = true
    if (!routeSessionId) nav.goReplace('/')
    else {
      // Hydration is gated on listSessions, so the summary already carries the
      // routing metadata. Fetching detail here downloaded the entire transcript
      // only to read projectId, then URL→store fetched that body again.
      const session = findSessionInState(useChatStore.getState(), routeSessionId)
      nav.goReplace(session ? scopePath(session.projectId ?? null, routeSessionId, sectionId) : '/')
    }
    legacyRedirecting.current = false
  }, [hasHydrated, isLegacyRoute, routeSessionId, sectionId, nav])

  // Launch-time workspace restore ("reopen last workspace"): on a true COLD
  // start — a post-hydration pass landing on the bare index `/` — reopen the scope+chat the
  // user was last in instead of the neutral global home. We redirect the URL (the source of
  // truth) and let the normal URL→store sync take over, so the restored route goes through
  // exactly the same resolution as one the user clicked.
  //
  // Scoped narrowly so it never hijacks an intentional home: it settles ONCE (a later
  // in-app navigation to `/` won't re-fire), only fires on `/` — never `/global`, which IS
  // the deliberate global home — and yields to any explicit navigation, including a
  // `?prompt=` deep link (`localix://new?prompt=…`), which is a request for a NEW chat.
  //
  // The decision table itself is {@link resolveLaunchRestore} (pure, unit tested). Its one
  // structural subtlety lives here: a `wait` verdict must HOLD the home effect below.
  // `_hasHydrated` is flipped synchronously by the pre-render shell frame, while the
  // projects roster arrives on its own request a beat later — so the first pass genuinely
  // cannot judge whether the remembered project still exists. Deciding anyway is what made
  // every relaunch land on a fresh Global chat; minting that draft would ALSO overwrite the
  // very record being restored from, so the mistake persisted itself.
  const launchRestoring = useRef(false)
  const launchSettled = useRef(false)
  const [launchWaitExpired, setLaunchWaitExpired] = useState(false)
  const projectsLoaded = useChatStore((state) => state.projectsLoaded)
  const releaseLastWorkspace = useRef<(() => void) | null>(null)
  // The held record is released once the roster answers (from then on writes mean what they
  // say again) or when the workspace unmounts.
  useEffect(() => {
    if (!projectsLoaded) return
    releaseLastWorkspace.current?.()
    releaseLastWorkspace.current = null
  }, [projectsLoaded])
  useEffect(
    () => () => {
      releaseLastWorkspace.current?.()
      releaseLastWorkspace.current = null
    },
    [],
  )
  useEffect(() => {
    if (!hasHydrated || launchSettled.current) return
    // Any URL other than a bare `/`, or an explicit new-chat deep link, is the user's own
    // navigation and outranks a remembered workspace.
    if (!isColdIndex || promptDeepLink) {
      launchSettled.current = true
      launchRestoring.current = false
      return
    }
    const state = useChatStore.getState()
    const decision = resolveLaunchRestore({
      remembered: loadLastWorkspace(),
      projects: state.projects,
      projectsLoaded,
      sessions: state.allSessions,
      waitExpired: launchWaitExpired,
    })
    if (decision.kind === 'wait') {
      // Declared BEFORE the home effect, so this latch is in place for the same commit.
      launchRestoring.current = true
      return
    }
    launchSettled.current = true
    if (decision.kind === 'home') {
      launchRestoring.current = false
      if (decision.forget) forgetLastWorkspace()
      // Unverified, not dead: the landing below must not overwrite it (see holdLastWorkspace).
      if (decision.keep) releaseLastWorkspace.current ??= holdLastWorkspace()
      return
    }
    launchRestoring.current = true
    goReplace(scopePath(decision.projectId, decision.sessionId))
  }, [hasHydrated, isColdIndex, promptDeepLink, goReplace, projectsLoaded, launchWaitExpired])

  // Bound the hold. The restore fires the instant the projects roster lands, so this timer
  // only governs the pathological case — a local service that never answers — where the
  // right outcome is the default-project landing, not a workspace that never opens.
  useEffect(() => {
    if (!hasHydrated || !isColdIndex || promptDeepLink) return
    const timer = setTimeout(() => {
      if (!launchSettled.current) setLaunchWaitExpired(true)
    }, LAUNCH_RESTORE_WAIT_MS)
    return () => clearTimeout(timer)
  }, [hasHydrated, isColdIndex, promptDeepLink])

  // Release the launch-restore latch the moment its redirect commits (the URL
  // leaves home). `launchRestoring` exists only to stop the home effect from
  // minting a second default-project draft during the transient pass where the cold `/`
  // hasn't yet become `/project/:id`. Without this reset it stayed latched for
  // the whole session, so returning to the neutral route was silently swallowed and the
  // URL→store sync could keep showing the previously active project.
  useEffect(() => {
    if (!isHomeRoute) launchRestoring.current = false
  }, [isHomeRoute])

  // Home: reuse or create a chat in the real default project, then stamp its canonical
  // project/session pair into the URL. Opening any other project never auto-creates.
  //
  // Deep link: `#/?prompt=<text>` (desktop `localix://new?prompt=…`) additionally
  // prefills the minted draft's composer. The insert is ADDRESSED to the new
  // session and buffered on the composerBus, so it lands in that composer once it
  // mounts — never in whatever chat happened to be open when the link arrived.
  // The redirect below drops the query, so a reload can't re-insert.
  const homeRedirecting = useRef(false)
  // Guards the lazy project-draft creation below from double-firing (StrictMode /
  // re-render) before the first create resolves and the URL restamps.
  const projectDrafting = useRef<string | null>(null)
  useEffect(() => {
    // A launch-time project restore just redirected off `/` — don't also mint a
    // second default-project draft this pass (isHomeRoute is still true until the URL updates).
    if (!hasHydrated || !isHomeRoute || homeRedirecting.current || launchRestoring.current) return
    homeRedirecting.current = true
    const prompt = promptDeepLink
    void createHomeDraft()
      .then((session) => {
        if (session) {
          if (prompt) composerBus.insert({ text: prompt, sessionId: session.id, buffer: true })
          // The draft's OWN project — the default one. The home landing has no scope of its
          // own to stamp any more, and the session is the thing that knows where it lives.
          nav.goReplace(scopePath(session.projectId, session.id))
        }
      })
      .finally(() => {
        homeRedirecting.current = false
      })
  }, [hasHydrated, isHomeRoute, createHomeDraft, nav, promptDeepLink])

  // URL → store: project first (it may reset the session), then session — run
  // sequentially so the two store actions don't race.
  useEffect(() => {
    if (!hasHydrated) return
    if (skipNextSync.current) {
      skipNextSync.current = false
      return
    }
    // Home owns the selection (cleared above) — don't auto-select a project/session.
    // Legacy `/chat/:id` is handled by its own redirect effect.
    if (isHomeRoute || isLegacyRoute) return
    let cancelled = false
    const sessionLoad = new AbortController()
    let stopSessionRetry: (() => void) | null = null
    void (async () => {
      if ((routeProjectId ?? null) !== (useChatStore.getState().activeProjectId ?? null)) {
        await selectProject(routeProjectId ?? null)
      }
      if (cancelled) return
      if (routeSessionId) {
        // A local sidecar can still be coming online, or briefly restart while
        // the webview remains mounted. One failed detail request must not strand
        // this route in Loading until the user switches away and back. Retry the
        // current route on the shared bounded startup cadence; cleanup aborts the
        // transport and prevents a retired response from reclaiming focus.
        stopSessionRetry = startStartupRetry(async () => {
          if (cancelled) return true
          const state = useChatStore.getState()
          if (!shouldLoadRoutedSession(state, routeSessionId)) return true
          try {
            await selectSession(routeSessionId, { signal: sessionLoad.signal })
            return true
          } catch (error) {
            if (cancelled || sessionLoad.signal.aborted) return true
            if (isMissingRoutedSessionError(error)) {
              goReplace(routeProjectId ? scopePath(routeProjectId) : '/')
              return true
            }
            return false
          }
        })
      }
      // An opened project with no sessions leaves activeSessionId null, which renders
      // the bare greeting (no composer) and hides the project from the sidebar (it
      // filters out session-less project groups). Mirror the home flow: lazily
      // create/reuse a project-scoped draft so the composer mounts and the project
      // becomes visible. createSession reuses an empty draft per scope, so repeated
      // opens never pile up duplicate drafts. The normalization redirect below then
      // stamps the new session id into the URL.
      if (cancelled) return
      if (
        routeProjectId &&
        !routeSessionId &&
        !useChatStore.getState().activeSessionId &&
        projectDrafting.current !== routeProjectId
      ) {
        projectDrafting.current = routeProjectId
        try {
          await createSession(undefined, scopedNewConversation(routeProjectId))
        } finally {
          if (projectDrafting.current === routeProjectId) projectDrafting.current = null
        }
      }
    })()
    return () => {
      cancelled = true
      stopSessionRetry?.()
      sessionLoad.abort()
    }
  }, [
    hasHydrated,
    routeProjectId,
    routeSessionId,
    selectProject,
    selectSession,
    createSession,
    isHomeRoute,
    isLegacyRoute,
    goReplace,
  ])

  // Normalization redirect: on a scope route with no session in the URL but a
  // resolved session in the store (e.g. after a scope switch), reflect it in the
  // path. Keeps the scope + section. Skipped on home/legacy so it doesn't bounce
  // the neutral landing or race the legacy redirect.
  useEffect(() => {
    if (!hasHydrated || !normalized.current || isHomeRoute || isLegacyRoute) return
    if (!routeSessionId && activeSessionId) {
      // A scope route with no session (e.g. a fresh `switchProject`) — restore the
      // FULL remembered location: the resolved session PLUS this scope's last open
      // section (files/jobs/database). Without this, switching project and back
      // dropped the open panel back to none. A section already in the URL wins.
      const restoredSection = sectionId ?? loadScopeLocation(routeProjectId).section
      if (routeProjectId) {
        nav.goReplace(scopePath(routeProjectId, activeSessionId, restoredSection))
      }
    }
  }, [
    hasHydrated,
    routeSessionId,
    activeSessionId,
    routeProjectId,
    sectionId,
    nav,
    isHomeRoute,
    isLegacyRoute,
  ])

  // Remember the live location per scope so a round-trip through another project
  // restores it. Recorded ONLY while a session is in the URL (the settled state) —
  // during the transient bare-scope moment of a switch, `sectionId` is null and
  // recording it would clobber the value the restore above is about to read.
  useEffect(() => {
    if (!hasHydrated || isHomeRoute || isLegacyRoute || !routeSessionId) return
    rememberScopeSection(routeProjectId ?? null, sectionId)
  }, [hasHydrated, routeProjectId, routeSessionId, sectionId, isHomeRoute, isLegacyRoute])

  // Per-scope left-sidebar open/closed: restore this scope's remembered state when
  // the scope changes (falling back to the global default for a never-seen scope),
  // and record it as the user toggles. Desktop only — on mobile the sidebar is a
  // full overlay whose open-state is transient (see the global effect above).
  const prevScopeRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (!hasHydrated || isMobile) return
    const scope = routeProjectId ?? null
    if (prevScopeRef.current === scope) return
    prevScopeRef.current = scope
    const remembered = loadScopeLocation(scope).sidebarOpen
    if (remembered !== null) setSidebarOpen(remembered)
  }, [hasHydrated, isMobile, routeProjectId, setSidebarOpen])
  useEffect(() => {
    if (!hasHydrated || isMobile || isHomeRoute || isLegacyRoute) return
    rememberScopeSidebarOpen(routeProjectId ?? null, sidebarOpen)
  }, [hasHydrated, isMobile, routeProjectId, sidebarOpen, isHomeRoute, isLegacyRoute])
}
