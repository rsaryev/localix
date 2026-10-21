import { useCallback, useEffect, useMemo, useRef } from 'react'
import { toast } from '@/shared/lib/notify'
import { useChatStore } from '@/entities/chat/model/store'
import { refreshConnections } from '@/entities/chat/model/connectionsSync'
import { backendClient } from '@/shared/api/client'
import { WS_BASE_URL } from '@/shared/api/internal'
import { useModelsCatalog } from '@/shared/hooks/useModelsCatalog'
import {
  runnableConnectionId,
  selectSessionConnectionId,
  selectSessionModelId,
} from './connectionScope'
import { isDesktop, getDesktopOAuthPort } from '@localixai/kit/environment'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { startOAuthConnectionPoll } from './oauthConnectionPolling'
import { returnToOAuthModels } from './oauthConnectionReturn'

/** A key connection's extras: more keys for its pool, and what a cloud names besides its key. */
export interface ApiKeyConnectionOptions {
  extraKeys?: string[]
  settings?: Record<string, string>
}

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
  const storedId = useChatStore((state) => selectSessionConnectionId(state, activeSessionId))
  const modelId = useChatStore((state) => selectSessionModelId(state, activeSessionId))
  const { models } = useModelsCatalog()
  // Every connection write is followed by the server's 'providers' topic, which re-reads the list
  // (`connectionsSync`). Only a flow that binds the connection it just created reads it now.

  // The connection the route RUNS on, by the server's rule (`routeReadiness`): the stored id is a
  // hint, and a route whose account was deleted and signed in again runs on the new one. Before
  // the session has a model, or while the catalog is still loading, the stored id is all there is.
  const activeId = useMemo(
    () => runnableConnectionId({ storedId, modelId, connections, models }),
    [connections, modelId, models, storedId],
  )
  const selectedConnection = connections.find((connection) => connection.id === activeId) ?? null
  // Stored metadata can outlive an unreadable vault payload. Keep that connection
  // in the management list, but never tell the composer it is runnable.
  const activeConnection = selectedConnection?.hasApiKey ? selectedConnection : null

  // OAuth-completion poll loops started by this hook instance. Each stop handle
  // also covers an in-flight tick, so its `finally` cannot schedule another read
  // after navigation.
  const oauthPollStops = useRef<Map<string, () => void>>(new Map())
  useEffect(() => {
    const stops = oauthPollStops.current
    return () => {
      for (const stop of stops.values()) stop()
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
        // The re-routed session comes back as `session.updated` on the stream.
        if (savedSessionId) {
          await backendClient.updateSession(savedSessionId, {
            route: { providerConnectionId: connection.id },
          })
        }
        returnToOAuthModels(connection, savedSessionId)
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
      opts?: ApiKeyConnectionOptions,
    ) => {
      const connection = await backendClient.createConnection({
        providerId,
        providerName,
        label: label || providerName,
        apiKey,
        apiKeys: opts?.extraKeys,
        ...(opts?.settings ? { settings: opts.settings } : {}),
      })
      await refreshConnections()
      if (activeSessionId) {
        await backendClient.updateSession(activeSessionId, {
          route: { providerConnectionId: connection.id },
        })
      }
      return connection
    },
    [activeSessionId],
  )

  const addOAuthConnection = useCallback(
    async (
      providerId: string,
      providerName: string,
      label: string,
      onConnected?: (connectionId: string) => void,
    ) => {
      // The server replaces an abandoned login on retry. Its old poll must not
      // mistake the replacement's connection for its own or report a timeout.
      oauthPollStops.current.get(providerId)?.()
      // Snapshot before starting login: a fast callback may persist before initiate returns.
      const baseline = useChatStore.getState().connections
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
        const stopPoll = startOAuthConnectionPoll({
          baseline,
          providerId,
          refresh: refreshConnections,
          read: () => useChatStore.getState().connections,
          async onConnected(fresh, signal) {
            if (activeSessionId) {
              await backendClient.updateSession(activeSessionId, {
                route: { providerConnectionId: fresh.id },
              })
              if (signal.aborted) return
            }
            // Each poll retains its originating session rather than reading another flow's
            // sessionStorage entry after the user starts a second sign-in.
            if (sessionStorage.getItem(OAUTH_STATE_KEY) === state) {
              sessionStorage.removeItem(OAUTH_STATE_KEY)
              sessionStorage.removeItem(OAUTH_SESSION_KEY)
            }
            onConnected?.(fresh.id)
            returnToOAuthModels(fresh, activeSessionId)
          },
          onStop: () => {
            if (oauthPollStops.current.get(providerId) === stopPoll) {
              oauthPollStops.current.delete(providerId)
            }
          },
          onTimeout: () => {
            toast.error(`Could not sign in to ${providerName}`, {
              description: 'The sign-in did not finish within two minutes. Try connecting again.',
            })
          },
        })
        oauthPollStops.current.set(providerId, stopPoll)
      }

      // device-code adapters (GitHub Copilot): the server polls until the user enters the
      // code at the verification URL. Surface the code to the form and poll for the new
      // connection. Open the verification page to save the user a click.
      const openSignIn = async (url: string | undefined) => {
        if (!url) return true
        const accepted = await platformCapabilities().external.requestOpen(url, true)
        if (accepted) return true
        if (sessionStorage.getItem(OAUTH_STATE_KEY) === state) {
          sessionStorage.removeItem(OAUTH_STATE_KEY)
          sessionStorage.removeItem(OAUTH_SESSION_KEY)
        }
        return false
      }
      if (mode === 'device-code') {
        if (!(await openSignIn(verificationUri))) return { mode: 'cancelled' } as const
        pollForNewConnection()
        return { mode, userCode, verificationUri } as const
      }

      // local-server adapters (Anthropic) redirect to their own fixed loopback URI and
      // finish server-side — never navigate the SPA away; open a window and poll.
      if (mode === 'local-server') {
        if (!(await openSignIn(redirectUrl))) return { mode: 'cancelled' } as const
        pollForNewConnection()
        return { mode } as const
      }

      // A future adapter may explicitly return to the SPA. Native pi browser
      // OAuth uses `local-server` above and never enters this branch.
      if (!isDesktop) {
        if (redirectUrl) window.location.href = redirectUrl
        return { mode } as const
      }
      if (!(await openSignIn(redirectUrl))) return { mode: 'cancelled' } as const
      pollForNewConnection()
      return { mode } as const
    },
    [activeSessionId],
  )

  // These writes return once the server committed them; its 'providers' topic then re-reads the
  // list through the one writer, so none of them patches the store itself.
  const remove = useCallback(async (id: string) => {
    await backendClient.deleteConnection(id)
  }, [])

  const updateLabel = useCallback(async (id: string, label: string) => {
    await backendClient.updateConnection(id, { label })
  }, [])

  const addKey = useCallback(async (id: string, apiKey: string, label?: string) => {
    await backendClient.addProviderKey(id, { apiKey, label })
  }, [])

  const removeKey = useCallback(async (id: string, keyId: string) => {
    await backendClient.removeProviderKey(id, keyId)
  }, [])

  const updateKey = useCallback(
    async (
      id: string,
      keyId: string,
      patch: { label?: string; priority?: number; enabled?: boolean },
    ) => {
      await backendClient.updateProviderKey(id, keyId, patch)
    },
    [],
  )

  /** A cloud connection's settings, replaced on every key. */
  const updateSettings = useCallback(async (id: string, settings: Record<string, string>) => {
    await backendClient.updateConnection(id, { settings })
  }, [])

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
      remove,
      updateLabel,
      updateSettings,
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
      remove,
      updateLabel,
      updateSettings,
      addKey,
      removeKey,
      updateKey,
    ],
  )
}
