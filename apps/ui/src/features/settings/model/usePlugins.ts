import { useCallback } from 'react'

import { backendClient } from '@/shared/api/client'
import type { PluginRecord } from '@/shared/api/contracts'
import { inlineFailure } from '@/shared/lib/notifications/inlineReport'
import { refetchActiveMiniAppContrib } from '@/shared/contrib/enabledMiniApps'
import { applyCapabilityRules } from '@/shared/contrib/capabilityCache'
import { availabilityChange } from '@/shared/contrib/capabilityRules'
import { useCapabilityRegistry } from '@/shared/contrib/useCapabilityRegistry'
import { useRegistryScope } from '@/shared/contrib/useRegistryScope'
import { trackCapabilityWrite } from '@/shared/contrib/capabilityWrites'
import { miniAppLabel } from '@localixai/mini-app-sdk/manifest-label'

export interface PluginsData {
  plugins: PluginRecord[]
  loading: boolean
  error: string | null
  /** Plugin name currently mutating (toggle/remove/save), for per-row busy UI. */
  busy: string | null
  /** Human-readable mutation state shown inline in the active registry row. */
  busyLabel: string | null
  refresh: () => void
  toggle: (p: PluginRecord) => Promise<void>
  remove: (p: PluginRecord) => Promise<void>
  /** Returns true on success so the caller can close the config form. */
  saveConfig: (
    p: PluginRecord,
    values: Record<string, string | number | boolean>,
  ) => Promise<boolean>
}

/**
 * Plugin list data + mutations for a given scope (project id or '' = global).
 *
 * The list comes from the scope's ONE capability snapshot — the same document the tool
 * list reads — projected by `useCapabilityRegistry`, like the agent and
 * MCP lists — so only the mutation bookkeeping (busy row, mutation error) is local. It
 * used to be an independent `GET /rpc/plugins` keyed on its own refresh key PLUS the
 * contribution version, while the tool list keyed on the version alone; a toggle that
 * advanced one key and not the other refreshed the plugin rows and left the tools
 * claiming to be enabled.
 */
export function usePlugins(scope: string, agentScope = ''): PluginsData {
  const registry = useCapabilityRegistry(scope, (snapshot) => snapshot.plugins)
  const { error, setError, busy, busyLabel, setBusy } = useRegistryScope()
  const plugins = registry.rows

  const refresh = useCallback(() => {
    setError(null)
    registry.refresh()
  }, [registry, setError])

  const toggle = async (p: PluginRecord) => {
    setBusy(p.name, `${p.enabled ? 'Disabling' : 'Enabling'} ${miniAppLabel(p)}`)
    // Optimistic flip so the toggle feels instant.
    registry.overlay((current) =>
      current.map((x) =>
        x.name === p.name && x.projectId === p.projectId ? { ...x, enabled: !x.enabled } : x,
      ),
    )
    // ONE request: it applies the change, answers with the scope's new document — which
    // the cache installs, so the rail, the palette and every gate converge from the same
    // answer — and registers itself with the write barrier.
    setError(
      await registry.mutate(
        () =>
          // The switch is a RULE, and a rule belongs to an agent — so it lands in the one
          // the page is pointed at, not in whichever project the row came from. Writing it
          // by project was the last place a project still decided what may run.
          applyCapabilityRules(agentScope, [availabilityChange('plugin', p.name, !p.enabled)]),
        'Could not turn this plugin on or off.',
      ),
    )
    setBusy(null)
  }

  const remove = async (p: PluginRecord) => {
    setBusy(p.name, `Removing ${miniAppLabel(p)}`)
    try {
      await trackCapabilityWrite(p.projectId || null, async () => {
        await backendClient.removePlugin(p.name, { projectId: p.projectId || null })
        await refetchActiveMiniAppContrib()
      })
    } catch (e) {
      setError(inlineFailure(e, 'Could not remove this plugin.'))
    } finally {
      setBusy(null)
      registry.refresh()
    }
  }

  const saveConfig = async (p: PluginRecord, values: Record<string, string | number | boolean>) => {
    setBusy(p.name, `Saving settings for ${miniAppLabel(p)}`)
    let ok = false
    try {
      await trackCapabilityWrite(p.projectId || null, async () => {
        await backendClient.setPluginConfig(p.name, values, { projectId: p.projectId || null })
        await refetchActiveMiniAppContrib()
      })
      ok = true
      registry.refresh()
    } catch (e) {
      setError(inlineFailure(e, "Could not save this plugin's configuration."))
    } finally {
      setBusy(null)
    }
    return ok
  }

  return {
    plugins,
    loading: registry.loading,
    // A mutation error is this hook's own; a load failure belongs to the shared document.
    error: error ?? (registry.error ? 'Could not load the plugins.' : null),
    busy,
    busyLabel,
    refresh,
    toggle,
    remove,
    saveConfig,
  }
}
