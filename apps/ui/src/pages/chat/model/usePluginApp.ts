import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useChatStore } from '@/entities/chat/model/store'
import { useAttentionStore } from '@/entities/chat/model/attention/store'
import { railViewletRegistry } from '@/shared/contrib/uiContrib'
import {
  pluginActivationVersion,
  subscribePluginActivation,
} from '@/shared/contrib/pluginActivation'
import { viewStateStore } from '@/shared/lib/view-state/store'
import { ensurePluginAppProject } from '@/shared/lib/pluginAppProject'
import { toast } from '@/shared/lib/notify'
import {
  pluginAppViewState,
  postToPluginApp,
  rememberPluginAppSession,
  type PluginAppContext,
} from '@/shared/lib/pluginApp'
import type { ResolvedTheme } from '@/shared/theme/useTheme'
import { openPageWorkItem } from './openPageWorkItem'
import { appConversation, startConversation } from './pluginAppConversation'
import { reportPluginAppAvailable, reportPluginAppUnavailable } from './pluginAppProblem'

interface PluginAppOptions {
  hasHydrated: boolean
  /** The enabled plugins once the capability snapshot is known; null before. */
  enabledPluginNames: ReadonlySet<string> | null
  activeSessionId: string | null
  goToSession: (id: string, options?: { project?: string }) => void
  resolvedTheme: ResolvedTheme
}

/**
 * Run the page as a plugin app (`shared/lib/pluginApp.ts`): open the app's conversation, show the
 * plugin's own screen in it, and keep the native window told which conversation and theme it is
 * showing. Inert in the workspace, where `app` is null.
 */
export function usePluginApp(
  app: PluginAppContext | null,
  {
    hasHydrated,
    enabledPluginNames,
    activeSessionId,
    goToSession,
    resolvedTheme,
  }: PluginAppOptions,
): { newConversation: (() => void) | null; projectId: string | null } {
  const [projectId, setProjectId] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const activeSessionIdRef = useRef(activeSessionId)
  activeSessionIdRef.current = activeSessionId
  useEffect(() => {
    if (!app || !hasHydrated) return
    let live = true
    ensurePluginAppProject(app.projectDir, app.name)
      .then(async (project) => {
        const conversation = await appConversation(app, project)
        if (!live) return
        setProjectId(project)
        // Arrive once; afterwards the app follows wherever the person goes in its project.
        if (activeSessionIdRef.current !== conversation) {
          goToSession(conversation, { project })
        } else setSessionId(conversation)
      })
      .catch(() => {
        if (live) toast.error(`Could not open ${app.name}`)
      })
    return () => {
      live = false
    }
    // Resolved once per page: the project and its first conversation do not depend on later navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, hasHydrated])

  // The conversation on screen is the app's when it is one of its project's: it becomes the one
  // the app shows and reopens on. One elsewhere (a link, the folder chip) is visited, not adopted.
  const activeProjectId = useChatStore(
    (state) => state.allSessions.find((session) => session.id === activeSessionId)?.projectId,
  )
  useEffect(() => {
    if (!app || !projectId || !activeSessionId || activeProjectId !== projectId) return
    setSessionId(activeSessionId)
    rememberPluginAppSession(app.plugin, activeSessionId)
    viewStateStore.set(pluginAppViewState(app.plugin), { sessionId: activeSessionId })
  }, [app, projectId, activeSessionId, activeProjectId])

  // The plugin's screen is the rail entry it contributes; it registers when its UI has loaded.
  // Each of the app's conversations gets it once; closing it there is the person's choice.
  const activation = useSyncExternalStore(subscribePluginActivation, pluginActivationVersion)
  const opened = useRef(new Set<string>())
  useEffect(() => {
    if (!app || !sessionId || activeSessionId !== sessionId || opened.current.has(sessionId)) return
    void activation
    const screen = railViewletRegistry.list().find((viewlet) => viewlet.pluginName === app.plugin)
    if (!screen) return
    opened.current.add(sessionId)
    openPageWorkItem(sessionId, { workKind: screen.kind, id: screen.kind, title: screen.title })
  }, [app, sessionId, activeSessionId, activation])

  // A plugin turned off or removed in Localix leaves the app with only its chat: one standing
  // problem while that lasts, settled when the plugin is back.
  const available = app && enabledPluginNames ? enabledPluginNames.has(app.plugin) : null
  useEffect(() => {
    if (!app || available === null) return
    if (available) reportPluginAppAvailable(app)
    else reportPluginAppUnavailable(app)
  }, [app, available])

  // Requests waiting on the person in the app's conversation badge its Dock icon.
  const waiting = useAttentionStore((state) =>
    sessionId ? state.items.filter((item) => item.sessionId === sessionId).length : 0,
  )
  useEffect(() => {
    if (app) postToPluginApp({ type: 'badge', text: waiting > 0 ? String(waiting) : null })
  }, [app, waiting])

  // New chat in an app starts it over in a new conversation of its project (a new game, an empty
  // board); arriving there makes it the app's.
  const starting = useRef(false)
  const newConversation = useCallback(() => {
    if (!app || !projectId || starting.current) return
    starting.current = true
    startConversation(projectId)
      .then((id) => goToSession(id, { project: projectId }))
      .catch(() => toast.error('Could not start a new conversation'))
      .finally(() => {
        starting.current = false
      })
  }, [app, projectId, goToSession])

  useEffect(() => {
    if (app) postToPluginApp({ type: 'theme', dark: resolvedTheme === 'dark' })
  }, [app, resolvedTheme])
  useEffect(() => {
    if (app) postToPluginApp({ type: 'session', id: sessionId })
  }, [app, sessionId])
  return { newConversation: app ? newConversation : null, projectId }
}
