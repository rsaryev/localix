import { useState } from 'react'

import type { McpServerRecord } from '@/shared/api/contracts'
import { inlineFailure } from '@/shared/lib/notifications/inlineReport'
import { useCapabilityRegistry } from '@/shared/contrib/useCapabilityRegistry'
import { applyCapabilityRules } from '@/shared/contrib/capabilityCache'
import { availabilityChange } from '@/shared/contrib/capabilityRules'
import { trackCapabilityWrite } from '@/shared/contrib/capabilityWrites'

export interface McpServersData {
  servers: McpServerRecord[]
  loading: boolean
  error: string | null
  /** The server currently switching, for the row's busy state. */
  busy: string | null
  refresh: () => void
  /** Flip one server's switch for the agent the page is pointed at. */
  toggleEnabled: (server: McpServerRecord) => Promise<void>
}

/**
 * The MCP servers of a scope and their switches. The rows are the scope's capability snapshot,
 * projected by the same hook the plugin and agent lists use. A server is added, configured,
 * tested and removed on its Store page; only whether the agent may reach it is set here.
 */
export function useMcpServers(scope: string, agentScope = ''): McpServersData {
  const registry = useCapabilityRegistry(
    scope,
    (snapshot) => snapshot.mcp as unknown as McpServerRecord[],
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = () => {
    setError(null)
    registry.refresh()
  }

  const toggleEnabled = async (server: McpServerRecord) => {
    if (busy) return
    const next = !server.enabled
    setBusy(server.id)
    setError(null)
    try {
      await trackCapabilityWrite(server.projectId || null, async () => {
        // Optimistic flip; a failed write puts it back.
        registry.overlay((rows) =>
          rows.map((row) => (row.id === server.id ? { ...row, enabled: next } : row)),
        )
        try {
          await applyCapabilityRules(agentScope, [availabilityChange('mcp', server.name, next)])
        } catch (e) {
          registry.overlay((rows) =>
            rows.map((row) => (row.id === server.id ? { ...row, enabled: server.enabled } : row)),
          )
          throw e
        }
      })
    } catch (e) {
      setError(inlineFailure(e, `Could not ${next ? 'enable' : 'disable'} ${server.name}.`))
    } finally {
      setBusy(null)
      refresh()
    }
  }

  return {
    servers: registry.rows,
    loading: registry.loading,
    error: error ?? registry.error,
    busy,
    refresh,
    toggleEnabled,
  }
}
