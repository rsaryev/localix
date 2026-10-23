import { useCallback, useEffect, useState } from 'react'

import type {
  SecretMeta,
  SecretBinding,
  VaultAuditEntry,
  VaultVersionMeta,
} from '@localixai/api/client'
import type { Problem } from '@localixai/mini-app-sdk/ui/problems'
import { secretsApi } from '@/shared/api/secretsApi'
import { useResourceRevision } from '@/shared/api/useResourceRevision'
import type { VaultSection } from './vaultSections'
import { vaultFailure } from './vaultProblem'

/**
 * THE VAULT'S SECONDARY COLLECTIONS — consumers, per-item versions, and the audit log.
 *
 * None of these is the Vault list. Each is fetched lazily, on a different trigger (the Usage
 * section, the selected item, the Activity section), each has its own in-flight flag, and none
 * of them is ever the reason the pane is empty. Splitting them off the workspace hook keeps
 * that hook about the list — its loading, filtering and selection — and puts the three
 * demand-driven loads where their triggers can be read together.
 *
 * They do NOT own a problem report. Every failure is handed to `onFailure` so the workspace
 * hook remains the single publisher for the Vault's subject; a second publisher would settle
 * the first one's Event Center row. A failed version or activity load is `stale`, not `blocked`
 * — the workspace decides that, because it is the one that knows whether the list has content.
 */
export function useVaultCollections(
  items: SecretMeta[],
  section: VaultSection,
  selectedKey: string | null,
  onFailure: (problem: Problem) => void,
) {
  const revision = useResourceRevision('vault')
  useEffect(() => {
    setVersionsByKey({})
  }, [revision])
  const [bindingsByKey, setBindingsByKey] = useState<Record<string, SecretBinding[]>>({})
  const [loadingUsage, setLoadingUsage] = useState(false)
  const [versionsByKey, setVersionsByKey] = useState<Record<string, VaultVersionMeta[]>>({})
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [activity, setActivity] = useState<VaultAuditEntry[]>([])
  const [loadingActivity, setLoadingActivity] = useState(false)

  const totalConsumers = Object.values(bindingsByKey).reduce(
    (count, bindings) => count + bindings.length,
    0,
  )

  const loadAllUsage = useCallback(async () => {
    setLoadingUsage(true)
    try {
      const pairs = await Promise.all(
        items.map(async (item) => [item.key, await secretsApi.bindings(item.key)] as const),
      )
      setBindingsByKey(Object.fromEntries(pairs))
    } catch (caught) {
      onFailure(vaultFailure(caught, 'Vault usage could not be loaded.'))
    } finally {
      setLoadingUsage(false)
    }
  }, [items, onFailure])

  useEffect(() => {
    if (section === 'usage') void loadAllUsage()
  }, [loadAllUsage, section])

  useEffect(() => {
    if (!selectedKey || versionsByKey[selectedKey]) return
    let active = true
    setLoadingVersions(true)
    void secretsApi
      .versions(selectedKey)
      .then((versions) => {
        if (active)
          setVersionsByKey((current) => ({
            ...current,
            [selectedKey]: versions,
          }))
      })
      .catch((caught: unknown) => {
        if (active) onFailure(vaultFailure(caught, "This item's history could not be loaded."))
      })
      .finally(() => {
        if (active) setLoadingVersions(false)
      })
    return () => {
      active = false
    }
  }, [selectedKey, versionsByKey, onFailure, revision])

  const loadActivity = useCallback(async () => {
    setLoadingActivity(true)
    try {
      setActivity(await secretsApi.activity())
    } catch (caught) {
      onFailure(vaultFailure(caught, 'Vault activity could not be loaded.'))
    } finally {
      setLoadingActivity(false)
    }
  }, [onFailure])

  useEffect(() => {
    if (section === 'activity') void loadActivity()
  }, [loadActivity, section, revision])

  /** A saved item's history is stale the moment it is written — drop it so the next
   *  selection re-fetches rather than showing the version list from before the save. */
  const forgetVersions = useCallback((key: string) => {
    setVersionsByKey((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
  }, [])

  return {
    activity,
    bindingsByKey,
    forgetVersions,
    loadingActivity,
    loadingUsage,
    loadingVersions,
    totalConsumers,
    versionsByKey,
  }
}
