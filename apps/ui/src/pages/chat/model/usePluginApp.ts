import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { backendClient } from '@/shared/api/client'
import { ApiError } from '@/shared/api/failure'
import { findSessionInState } from '@/entities/chat/model/findSession'
import { applyServerSession } from '@/entities/chat/model/sessionSync'
import { useChatStore } from '@/entities/chat/model/store'
import { useAttentionStore } from '@/entities/chat/model/attention/store'
import { railViewletRegistry } from '@/shared/contrib/uiContrib'
import {
  pluginActivationVersion,
  subscribePluginActivation,
} from '@/shared/contrib/pluginActivation'
import { viewStateStore } from '@/shared/lib/view-state/store'
import { toast } from '@/shared/lib/notify'
import {
  pluginAppViewState,
  postToPluginApp,
  rememberPluginAppSession,
  type PluginAppContext,
} from '@/shared/lib/pluginApp'
import type { ResolvedTheme } from '@/shared/theme/useTheme'
import { openPageWorkItem } from './openPageWorkItem'

const isMissingSession = (error: unknown) =>
  error instanceof ApiError && error.code === 'session_not_found'

/**
 * The conversation a plugin app shows: the one it remembers while that still exists, otherwise a
 * new one named after the app. Plugins are built around a chat ("the chat is the table"), so the
 * app gets its own rather than borrowing whichever one the workspace has open.
 */
async function appConversation(app: PluginAppContext): Promise<string> {
  const address = pluginAppViewState(app.plugin)
  const selected = await viewStateStore.ready(address)
  const remembered =
    selected.value && 'sessionId' in selected.value ? selected.value.sessionId : null
  if (remembered) {
    if (findSessionInState(useChatStore.getState(), remembered)) return remembered
    try {
      applyServerSession(await backendClient.getSession(remembered))
      return remembered
    } catch (error) {
      if (!isMissingSession(error)) throw error
    }
  }
  return startConversation(app)
}

/** A new conversation for the app, remembered as the one it shows from now on. */
async function startConversation(app: PluginAppContext): Promise<string> {
  const session = await backendClient.createSession({ title: app.name, projectId: null })
  applyServerSession(session)
  viewStateStore.set(pluginAppViewState(app.plugin), { sessionId: session.id })
  return session.id
}

interface PluginAppOptions {
  hasHydrated: boolean
  /** The enabled plugins once the capability snapshot is known; null before. */
  enabledPluginNames: ReadonlySet<string> | null
  activeSessionId: string | null
  goToSession: (id: string) => void
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
): { newConversation: (() => void) | null } {
  const [sessionId, setSessionId] = useState<string | null>(null)
  useEffect(() => {
    if (!app || !hasHydrated) return
    let live = true
    appConversation(app)
      .then((id) => {
        if (!live) return
        rememberPluginAppSession(app.plugin, id)
        setSessionId(id)
      })
      .catch(() => {
        if (live) toast.error(`Could not open ${app.name}`)
      })
    return () => {
      live = false
    }
  }, [app, hasHydrated])

  // Once: the app's conversation is where it starts. Links inside it may still go elsewhere.
  const arrived = useRef(false)
  useEffect(() => {
    if (!sessionId || arrived.current) return
    arrived.current = true
    if (activeSessionId !== sessionId) goToSession(sessionId)
  }, [sessionId, activeSessionId, goToSession])

  // The plugin's screen is the rail entry it contributes; it registers when its UI has loaded.
  const activation = useSyncExternalStore(subscribePluginActivation, pluginActivationVersion)
  const opened = useRef<string | null>(null)
  useEffect(() => {
    if (!app || !sessionId || activeSessionId !== sessionId || opened.current === sessionId) return
    void activation
    const screen = railViewletRegistry.list().find((viewlet) => viewlet.pluginName === app.plugin)
    if (!screen) return
    opened.current = sessionId
    openPageWorkItem(sessionId, { workKind: screen.kind, id: screen.kind, title: screen.title })
  }, [app, sessionId, activeSessionId, activation])

  // A plugin turned off or removed in Localix leaves the app with only its chat; say why, once.
  const unavailable = Boolean(app && enabledPluginNames && !enabledPluginNames.has(app.plugin))
  useEffect(() => {
    if (app && unavailable) {
      toast.warning(`${app.name} is turned off in Localix`, {
        description: 'Turn the plugin on in Localix to use this app.',
      })
    }
  }, [app, unavailable])

  // Requests waiting on the person in the app's conversation badge its Dock icon.
  const waiting = useAttentionStore((state) =>
    sessionId ? state.items.filter((item) => item.sessionId === sessionId).length : 0,
  )
  useEffect(() => {
    if (app) postToPluginApp({ type: 'badge', text: waiting > 0 ? String(waiting) : null })
  }, [app, waiting])

  // New chat in an app starts the app over in a fresh conversation (a new game, an empty board),
  // and the app keeps that one from now on.
  const starting = useRef(false)
  const newConversation = useCallback(() => {
    if (!app || starting.current) return
    starting.current = true
    startConversation(app)
      .then((id) => {
        rememberPluginAppSession(app.plugin, id)
        setSessionId(id)
        goToSession(id)
      })
      .catch(() => toast.error('Could not start a new conversation'))
      .finally(() => {
        starting.current = false
      })
  }, [app, goToSession])

  useEffect(() => {
    if (app) postToPluginApp({ type: 'theme', dark: resolvedTheme === 'dark' })
  }, [app, resolvedTheme])
  useEffect(() => {
    if (app) postToPluginApp({ type: 'session', id: sessionId })
  }, [app, sessionId])
  return { newConversation: app ? newConversation : null }
}
