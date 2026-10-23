import { useCallback } from 'react'

import { backendClient } from '@/shared/api/client'
import type { MiniAppRecord } from '@/shared/api/contracts'
import { inlineFailure } from '@/shared/lib/notifications/inlineReport'
import { applyCapabilityRules } from '@/shared/contrib/capabilityCache'
import { availabilityChange } from '@/shared/contrib/capabilityRules'
import { useCapabilityRegistry } from '@/shared/contrib/useCapabilityRegistry'
import { useRegistryScope } from '@/shared/contrib/useRegistryScope'
import { trackCapabilityWrite } from '@/shared/contrib/capabilityWrites'
import { miniAppLabel } from '@localixai/mini-app-sdk/manifest-label'

export interface MiniAppsData {
  miniApps: MiniAppRecord[]
  loading: boolean
  error: string | null
  /** The app currently mutating, for the row's busy state. */
  busy: string | null
  busyLabel: string | null
  refresh: () => void
  toggle: (app: MiniAppRecord) => Promise<void>
  remove: (app: MiniAppRecord) => Promise<void>
  /** True on success, so the caller can close the settings form. */
  saveConfig: (
    app: MiniAppRecord,
    values: Record<string, string | number | boolean>,
  ) => Promise<boolean>
}

/**
 * The mini apps of a scope and their mutations. The list is the scope's capability snapshot
 * (`miniApps`), the same document the rail and the tool list read; a write records a `mini-app`
 * notice, and every surface re-reads on its poke — nothing here patches another store.
 */
export function useMiniApps(scope: string, agentScope = ''): MiniAppsData {
  const registry = useCapabilityRegistry(scope, (snapshot) => snapshot.miniApps)
  const { error, setError, busy, busyLabel, setBusy } = useRegistryScope()

  const refresh = useCallback(() => {
    setError(null)
    registry.refresh()
  }, [registry, setError])

  const toggle = async (app: MiniAppRecord) => {
    setBusy(app.name, `${app.enabled ? 'Turning off' : 'Turning on'} ${miniAppLabel(app)}`)
    registry.overlay((current) =>
      current.map((row) =>
        row.name === app.name && row.projectId === app.projectId
          ? { ...row, enabled: !row.enabled }
          : row,
      ),
    )
    // A switch is a rule on the agent the page is pointed at (`mini-app:<name>`).
    setError(
      await registry.mutate(
        () =>
          applyCapabilityRules(agentScope, [
            availabilityChange('mini-app', app.name, !app.enabled),
          ]),
        'Could not turn this mini app on or off.',
      ),
    )
    setBusy(null)
  }

  const remove = async (app: MiniAppRecord) => {
    setBusy(app.name, `Removing ${miniAppLabel(app)}`)
    try {
      await trackCapabilityWrite(app.projectId || null, () =>
        backendClient.removeMiniApp(app.name, { projectId: app.projectId || null }),
      )
    } catch (e) {
      setError(inlineFailure(e, 'Could not remove this mini app.'))
    } finally {
      setBusy(null)
      registry.refresh()
    }
  }

  const saveConfig = async (
    app: MiniAppRecord,
    values: Record<string, string | number | boolean>,
  ) => {
    setBusy(app.name, `Saving settings for ${miniAppLabel(app)}`)
    let ok = false
    try {
      await trackCapabilityWrite(app.projectId || null, () =>
        backendClient.setMiniAppConfig(app.name, values, { projectId: app.projectId || null }),
      )
      ok = true
      registry.refresh()
    } catch (e) {
      setError(inlineFailure(e, "Could not save this mini app's settings."))
    } finally {
      setBusy(null)
    }
    return ok
  }

  return {
    miniApps: registry.rows,
    loading: registry.loading,
    error: error ?? (registry.error ? 'Could not load the mini apps.' : null),
    busy,
    busyLabel,
    refresh,
    toggle,
    remove,
    saveConfig,
  }
}
