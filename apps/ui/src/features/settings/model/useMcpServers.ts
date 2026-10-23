import { useEffect, useRef, useState } from 'react'

import { backendClient } from '@/shared/api/client'
import type { McpServerRecord, McpProbeResult } from '@/shared/api/contracts'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { inlineFailure } from '@/shared/lib/notifications/inlineReport'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { useCapabilityRegistry } from '@/shared/contrib/useCapabilityRegistry'
import { applyCapabilityRules } from '@/shared/contrib/capabilityCache'
import { availabilityChange, mcpToolAction } from '@/shared/contrib/capabilityRules'
import { trackCapabilityWrite } from '@/shared/contrib/capabilityWrites'

export interface McpServersData {
  servers: McpServerRecord[]
  loading: boolean
  error: string | null
  /** Per-row live connection status: id -> probe result or 'loading'. */
  status: Record<string, McpProbeResult | 'loading'>
  /** Per-row mutation label. The stable status slot turns into activity while present. */
  mutations: Record<string, string>
  /** Re-fetch the server list (and re-probe enabled servers). */
  refresh: () => void
  /** Manually probe one server's connection, updating `status`. */
  probeServer: (server: McpServerRecord) => Promise<void>
  /** Optimistically flip a server's enabled flag (re-probes on enable). */
  toggleEnabled: (server: McpServerRecord) => Promise<void>
  /** Enable or disable one tool using the server's canonical runtime filter. */
  setToolEnabled: (server: McpServerRecord, toolName: string, enabled: boolean) => Promise<void>
  /** Delete a server and refresh the list. */
  remove: (server: McpServerRecord) => Promise<void>
  /** Begin an interactive OAuth sign-in (opens a browser), then refresh. */
  signIn: (server: McpServerRecord) => Promise<void>
  /** Forget a remote server's stored OAuth tokens (sign out), then refresh. */
  signOut: (server: McpServerRecord) => Promise<void>
}

/**
 * MCP server list data + live connection probing for a given scope (project id
 * or null = global). Loads on scope/refresh change, and auto-probes any enabled
 * server lacking a status so the user sees real works/down state. Extracted from
 * McpSettings so the component owns only the add/edit form.
 */
export function useMcpServers(scope: string, agentScope = ''): McpServersData {
  const workItemVisible = useWorkItemVisible()
  // The rows come from the scope's ONE capability document, projected by the same hook
  // the plugin and agent lists use, so the three cannot drift apart.
  const registry = useCapabilityRegistry(
    scope,
    (snapshot) => snapshot.mcp as unknown as McpServerRecord[],
  )
  const servers = registry.rows
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<Record<string, McpProbeResult | 'loading'>>({})
  const [mutations, setMutations] = useState<Record<string, string>>({})
  const probingIds = useRef(new Set<string>())
  const mutatingIds = useRef(new Set<string>())

  const refresh = () => {
    setError(null)
    registry.refresh()
  }

  const setServers = registry.overlay

  const probeServer = async (s: McpServerRecord) => {
    if (probingIds.current.has(s.id)) return
    probingIds.current.add(s.id)
    setStatus((prev) => ({ ...prev, [s.id]: 'loading' }))
    try {
      const result = await backendClient.testMcpServer(s.id)
      setStatus((prev) => ({ ...prev, [s.id]: result }))
    } catch (e) {
      setStatus((prev) => ({
        ...prev,
        [s.id]: { ok: false, tools: [], error: inlineFailure(e, 'This server did not answer.') },
      }))
    } finally {
      probingIds.current.delete(s.id)
    }
  }

  const runServerMutation = async (
    server: McpServerRecord,
    label: string,
    failureMessage: string,
    action: () => Promise<void>,
  ): Promise<void> => {
    if (mutatingIds.current.has(server.id)) return
    mutatingIds.current.add(server.id)
    setMutations((prev) => ({ ...prev, [server.id]: label }))
    setError(null)
    try {
      await trackCapabilityWrite(server.projectId || null, action)
    } catch (e) {
      setError(inlineFailure(e, failureMessage))
    } finally {
      mutatingIds.current.delete(server.id)
      setMutations((prev) => {
        const next = { ...prev }
        delete next[server.id]
        return next
      })
      refresh()
    }
  }

  // Probe any enabled server that doesn't have a status yet (initial load + after
  // a toggle/refresh, where we clear the stale entry so it re-checks).
  useEffect(() => {
    if (!workItemVisible) return
    servers.forEach((s) => {
      if (s.enabled && status[s.id] === undefined) void probeServer(s)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers, workItemVisible])

  const toggleEnabled = async (s: McpServerRecord) => {
    const next = !s.enabled
    await runServerMutation(
      s,
      `${next ? 'Enabling' : 'Disabling'} ${s.name}`,
      `Could not ${next ? 'enable' : 'disable'} ${s.name}.`,
      async () => {
        // Optimistic flip; targeted PATCH touches only `enabled` (no config clobber).
        setServers((prev) => prev.map((x) => (x.id === s.id ? { ...x, enabled: next } : x)))
        // Drop stale connection state so enabling re-probes and disabling reads cleanly.
        setStatus((prev) => {
          const rest = { ...prev }
          delete rest[s.id]
          return rest
        })
        try {
          await applyCapabilityRules(agentScope, [availabilityChange('mcp', s.name, next)])
        } catch (e) {
          setServers((prev) => prev.map((x) => (x.id === s.id ? { ...x, enabled: s.enabled } : x)))
          throw e
        }
      },
    )
  }

  const setToolEnabled = async (s: McpServerRecord, toolName: string, enabled: boolean) => {
    await runServerMutation(
      s,
      `${enabled ? 'Enabling' : 'Disabling'} ${toolName}`,
      `Could not ${enabled ? 'enable' : 'disable'} ${toolName}.`,
      async () => {
        // A per-tool rule, exactly like every other switch. It used to edit the server's
        // stored config, which is part of the connection cache key — so hiding one tool
        // reconnected the server and blanked its inventory until the next run.
        const next = await applyCapabilityRules(agentScope, [
          {
            action: mcpToolAction(s.name, toolName),
            resource: '*',
            effect: enabled ? 'allow' : 'deny',
          },
        ])
        const updated = next.mcp.find((server) => server.id === s.id)
        if (updated) {
          setServers((prev) =>
            prev.map((server) => (server.id === s.id ? (updated as McpServerRecord) : server)),
          )
        }
        setStatus((prev) => {
          const current = prev[s.id]
          if (!current || current === 'loading' || !current.ok) return prev
          const active = new Set(current.tools)
          if (enabled) active.add(toolName)
          else active.delete(toolName)
          return { ...prev, [s.id]: { ...current, tools: [...active] } }
        })
      },
    )
  }

  const remove = async (s: McpServerRecord) => {
    await runServerMutation(s, `Deleting ${s.name}`, `Could not delete ${s.name}.`, () =>
      backendClient.deleteMcpServer(s.id),
    )
  }

  const signIn = async (s: McpServerRecord) => {
    await runServerMutation(
      s,
      `Starting sign-in for ${s.name}`,
      `Could not start sign-in for ${s.name}.`,
      async () => {
        const result = await backendClient.startMcpServerOAuth(s.id)
        if (result.authorizationUrl) {
          // Open the provider's consent page; the loopback callback stores the
          // token. openExternal, NOT window.open — a programmatic (post-await, no
          // user gesture) window.open is unreliable in the desktop webview.
          platformCapabilities().external.open(result.authorizationUrl, true)
        }
      },
    )
  }

  const signOut = async (s: McpServerRecord) => {
    await runServerMutation(
      s,
      `Signing out of ${s.name}`,
      `Could not sign out of ${s.name}.`,
      async () => {
        try {
          await backendClient.logoutMcpServerOAuth(s.id)
        } finally {
          setStatus((prev) => {
            const rest = { ...prev }
            delete rest[s.id]
            return rest
          })
        }
      },
    )
  }

  return {
    servers,
    loading: registry.loading,
    error: error ?? registry.error,
    status,
    mutations,
    refresh,
    probeServer,
    toggleEnabled,
    setToolEnabled,
    remove,
    signIn,
    signOut,
  }
}
