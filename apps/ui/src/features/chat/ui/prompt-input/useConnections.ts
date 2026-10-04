import { useCallback, useEffect, useMemo, useRef } from 'react'
import { toast } from '@/shared/lib/notify'
import { useChatStore } from '@/features/chat/model/store'
import { backendClient } from '@/shared/api/client'
import { WS_BASE_URL } from '@/shared/api/internal'
import { selectSessionConnectionId } from './connectionScope'
import { isDesktop, getDesktopOAuthPort } from '@localixai/kit/environment'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { findChangedOAuthConnection } from './oauthConnectionPolling'

const OAUTH_STATE_KEY = 'localix_oauth_state'
const OAUTH_SESSION_KEY = 'localix_oauth_session_id'

/**
 * The provider connections, and the ones `sessionId` routes through.
 *
 * `sessionId` is required, and `null` from a surface that belongs to no chat (Settings,
 * onboarding). An omitted one used to mean "the chat on screen", so connecting a provider from
 * the agent editor or the first-run step silently re-routed whatever conversation happened to be
 * open. The caller says which chat a new connection is for; with none, it routes no chat.
 */
export function useConnections(sessionId: string | null) {
  const connections = useChatStore((state) => state.connections)
  // Primitive selectors only: session OBJECTS are recreated on streamed updates,
  // so selecting one would re-render this hook's host per token. The connection
  // selector still checks both the working list and the full roster, matching the
  // surface resolver during cross-scope New Chat transitions.
  const activeSessionId = sessionId
  const activeId = useChatStore((state) => selectSessionConnectionId(state, activeSessionId))
  const replaceSession = useChatStore((state) => state._replaceSession)
  // Connection mutations only change the connections list — refetch ONLY
  // /rpc/provider-connections, never the whole workspace (sessions + projects +
  // getSession). The old `mutate('workspace')` pulled all four endpoints.
  const refreshConnections = useChatStore((state) => state.refreshConnections)

  const selectedConnection = connections.find((connection) => connection.id === activeId) ?? null
  // Stored metadata can outlive an unreadable vault payload. Keep that connection
  // in the management list, but never tell the composer it is runnable.
  const activeConnection = selectedConnection?.hasApiKey ? selectedConnection : null

  // OAuth-completion poll loops started by this hook instance. Each stop handle
  // also covers an in-flight tick, so its `finally` cannot schedule another read
  // after navigation.
  const oauthPollStops = useRef<Set<() => void>>(new Set())
  useEffect(() => {
    const stops = oauthPollStops.current
    return () => {
      for (const stop of stops) stop()
      stops.clear()
    }
  }, [])

  // Handle OAuth callback: detect ?code= in URL and pending state in sessionStorage
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = sessionStorage.getItem(OAUTH_STATE_KEY)

    if (!code || !state) return

    sessionStorage.removeItem(OAUTH_STATE_KEY)
    const savedSessionId = sessionStorage.getItem(OAUTH_SESSION_KEY)
    sessionStorage.removeItem(OAUTH_SESSION_KEY)

    // Clean up the URL — strip the ?code/&state search params but KEEP the hash
    // route. An OAuth provider returns to `/?code=…&state=…#/setup`; dropping the
    // hash here would bounce the user off the page they signed in from (e.g. the
    // onboarding wizard) right after the exchange.
    const clean = window.location.origin + window.location.pathname + window.location.hash
    window.history.replaceState({}, '', clean)

    backendClient
      .completeOAuth({ code, state })
      .then(async (connection) => {
        await refreshConnections()
        if (savedSessionId) {
          const session = await backendClient.updateSession(savedSessionId, {
            route: { providerConnectionId: connection.id },
          })
          replaceSession(session)
        }
      })
      .catch((e) => {
        toast.error('Could not complete the provider sign-in', {
          description: errorMessage(e, '') || undefined,
        })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addApiKeyConnection = useCallback(
    async (
      providerId: string,
      providerName: string,
      label: string,
      apiKey: string,
      opts?: { extraKeys?: string[] },
    ) => {
      const connection = await backendClient.createConnection({
        providerId,
        providerName,
        label: label || providerName,
        apiKey,
        apiKeys: opts?.extraKeys,
      })
      await refreshConnections()
      if (activeSessionId) {
        const session = await backendClient.updateSession(activeSessionId, {
          route: { providerConnectionId: connection.id },
        })
        replaceSession(session)
      }
      return connection
    },
    [activeSessionId, replaceSession, refreshConnections],
  )

  // Connect a provider whose API key the server detected in its environment.
  // The secret is read server-side (never sent here); we just name the provider.
  const connectFromEnv = useCallback(
    async (providerId: string) => {
      const connection = await backendClient.connectFromEnv(providerId)
      await refreshConnections()
      if (activeSessionId) {
        const session = await backendClient.updateSession(activeSessionId, {
          route: { providerConnectionId: connection.id },
        })
        replaceSession(session)
      }
      return connection
    },
    [activeSessionId, replaceSession, refreshConnections],
  )

  const addOAuthConnection = useCallback(
    async (providerId: string, providerName: string, label: string) => {
      // In desktop mode the OAuth callback must go to a localhost URL that the
      // embedded *API* server handles (app.ts completes it server-side and shows a
      // "Connected" page) — the system browser cannot render an embedded webview
      // route, and it has no access to this webview's sessionStorage, so the web
      // flow's client-side completion cannot run there. The STABLE OAuth port is
      // only injected in the packaged app; under `tauri dev` it's absent, and the
      // callback must NOT fall back to the page origin — that's Vite (:5050), which
      // serves the SPA and does not proxy the `/` callback. Point at the running API
      // instead (WS_BASE_URL is the API origin in both desktop dev :5051 and prod), never
      // `http://localhost:undefined/` (which the API rejects as an invalid URL).
      const oauthPort = getDesktopOAuthPort()
      const callbackUrl = isDesktop
        ? oauthPort !== undefined
          ? `http://localhost:${oauthPort}/`
          : `${WS_BASE_URL}/`
        : window.location.origin + window.location.pathname

      const { redirectUrl, state, mode, userCode, verificationUri } =
        await backendClient.initiateOAuth({
          providerId,
          providerName,
          label: label || providerName,
          callbackUrl,
        })

      sessionStorage.setItem(OAUTH_STATE_KEY, state)
      if (activeSessionId) sessionStorage.setItem(OAUTH_SESSION_KEY, activeSessionId)

      // Poll the workspace until the connection the server creates appears, then bind
      // it to the active session. Used for desktop OAuth and for local-server flows
      // (e.g. Anthropic, whose loopback callback completes the flow server-side).
      const pollForNewConnection = () => {
        const baseline = useChatStore.getState().connections
        let attempts = 0
        let stopped = false
        let timer: number | null = null
        const stopPoll = () => {
          if (stopped) return
          stopped = true
          if (timer !== null) window.clearTimeout(timer)
          timer = null
          oauthPollStops.current.delete(stopPoll)
        }
        const tick = async () => {
          // The user is completing the OAuth flow in another tab/window — don't
          // poll while this tab is backgrounded; resume when they return. This
          // also caps wall-clock to active foreground time.
          if (document.hidden || stopped) return
          attempts += 1
          await refreshConnections()
          if (stopped) return
          const fresh = findChangedOAuthConnection(
            baseline,
            useChatStore.getState().connections,
            providerId,
          )
          if (fresh) {
            sessionStorage.removeItem(OAUTH_STATE_KEY)
            const savedSessionId = sessionStorage.getItem(OAUTH_SESSION_KEY)
            sessionStorage.removeItem(OAUTH_SESSION_KEY)
            if (savedSessionId) {
              const session = await backendClient.updateSession(savedSessionId, {
                route: { providerConnectionId: fresh.id },
              })
              replaceSession(session)
            }
            stopPoll()
          } else if (attempts >= 40) {
            // ~120s of active polling (40 × 3s) — give up so an abandoned OAuth
            // flow can't refetch forever. Giving up used to be silent, which read
            // exactly like a sign-in that had worked.
            stopPoll()
            toast.error(`Could not sign in to ${providerName}`, {
              description: 'The sign-in did not finish within two minutes. Try connecting again.',
            })
          }
        }
        const schedule = () => {
          if (stopped) return
          timer = window.setTimeout(() => {
            timer = null
            // A failed tick is not reported: the next one retries, and the give-up above is
            // where an abandoned sign-in actually becomes news.
            void tick()
              .catch(() => {})
              .finally(schedule)
          }, 3000)
        }
        oauthPollStops.current.add(stopPoll)
        schedule()
      }

      // device-code adapters (GitHub Copilot): the server polls until the user enters the
      // code at the verification URL. Surface the code to the form and poll for the new
      // connection. Open the verification page to save the user a click.
      if (mode === 'device-code') {
        if (verificationUri) platformCapabilities().external.open(verificationUri)
        pollForNewConnection()
        return { mode, userCode, verificationUri } as const
      }

      // local-server adapters (Anthropic) redirect to their own fixed loopback URI and
      // finish server-side — never navigate the SPA away; open a window and poll.
      if (mode === 'local-server') {
        if (redirectUrl) platformCapabilities().external.open(redirectUrl)
        pollForNewConnection()
        return { mode } as const
      }

      // A future adapter may explicitly return to the SPA. Native pi browser
      // OAuth uses `local-server` above and never enters this branch.
      if (!isDesktop) {
        if (redirectUrl) window.location.href = redirectUrl
        return { mode } as const
      }
      if (redirectUrl) platformCapabilities().external.open(redirectUrl)
      pollForNewConnection()
      return { mode } as const
    },
    [activeSessionId, replaceSession, refreshConnections],
  )

  const remove = useCallback(
    async (id: string) => {
      await backendClient.deleteConnection(id)
      await refreshConnections()
    },
    [refreshConnections],
  )

  const updateLabel = useCallback(
    async (id: string, label: string) => {
      await backendClient.updateConnection(id, { label })
      await refreshConnections()
    },
    [refreshConnections],
  )

  // Key mutations patch the single connection in place (the API returns the
  // updated connection) rather than refetching the whole workspace — that keeps
  // the model-select drawer open and is far cheaper.
  const replaceConnection = useChatStore((state) => state._replaceConnection)

  const addKey = useCallback(
    async (id: string, apiKey: string, label?: string) => {
      replaceConnection(await backendClient.addProviderKey(id, { apiKey, label }))
    },
    [replaceConnection],
  )

  const removeKey = useCallback(
    async (id: string, keyId: string) => {
      replaceConnection(await backendClient.removeProviderKey(id, keyId))
    },
    [replaceConnection],
  )

  const updateKey = useCallback(
    async (
      id: string,
      keyId: string,
      patch: { label?: string; priority?: number; enabled?: boolean },
    ) => {
      replaceConnection(await backendClient.updateProviderKey(id, keyId, patch))
    },
    [replaceConnection],
  )

  // Memoized: this object is passed WHOLE into the composer's model picker, so a
  // fresh literal per render would defeat every `memo()` downstream of it. Every
  // member is either a store value or a `useCallback`, so the identity changes
  // only when the connection state actually does.
  return useMemo(
    () => ({
      connections,
      activeConnection,
      activeId,
      addApiKeyConnection,
      addOAuthConnection,
      connectFromEnv,
      remove,
      updateLabel,
      addKey,
      removeKey,
      updateKey,
    }),
    [
      connections,
      activeConnection,
      activeId,
      addApiKeyConnection,
      addOAuthConnection,
      connectFromEnv,
      remove,
      updateLabel,
      addKey,
      removeKey,
      updateKey,
    ],
  )
}
