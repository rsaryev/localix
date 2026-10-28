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

/** Stands in for the histories of a revision that has read none yet (a stable identity). */
const NO_VERSIONS: Record<string, VaultVersionMeta[]> = {}

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
  const [bindingsByKey, setBindingsByKey] = useState<Record<string, SecretBinding[]>>({})
  // Histories are tagged with the vault revision they were read at: a newer revision makes every
  // one of them stale at once, with nothing to reset.
  const [versions, setVersions] = useState<{
    revision: number
    byKey: Record<string, VaultVersionMeta[]>
  }>({ revision, byKey: {} })
  const versionsByKey = versions.revision === revision ? versions.byKey : NO_VERSIONS
  const [activity, setActivity] = useState<VaultAuditEntry[]>([])
  // Each demand-driven read is "loading" from the moment its section (or item) asks for it until
  // it settles; the cleanup of a read marks the next one as unsettled.
  const [usageSettled, setUsageSettled] = useState(false)
  const [versionsSettled, setVersionsSettled] = useState(false)
  const [activitySettled, setActivitySettled] = useState(false)
  const loadingUsage = section === 'usage' && !usageSettled
  const loadingVersions = !!selectedKey && !versionsByKey[selectedKey] && !versionsSettled
  const loadingActivity = section === 'activity' && !activitySettled

  const totalConsumers = Object.values(bindingsByKey).reduce(
    (count, bindings) => count + bindings.length,
    0,
  )

  useEffect(() => {
    if (section !== 'usage') return
    let active = true
    void Promise.all(
      items.map(async (item) => [item.key, await secretsApi.bindings(item.key)] as const),
    )
      .then((pairs) => {
        if (active) setBindingsByKey(Object.fromEntries(pairs))
      })
      .catch((caught: unknown) => {
        if (active) onFailure(vaultFailure(caught, 'Vault usage could not be loaded.'))
      })
      .finally(() => {
        if (active) setUsageSettled(true)
      })
    return () => {
      active = false
      setUsageSettled(false)
    }
  }, [items, onFailure, section])

  useEffect(() => {
    if (!selectedKey || versionsByKey[selectedKey]) return
    let active = true
    void secretsApi
      .versions(selectedKey)
      .then((read) => {
        if (active)
          setVersions((current) => ({
            revision,
            byKey: { ...(current.revision === revision ? current.byKey : {}), [selectedKey]: read },
          }))
      })
      .catch((caught: unknown) => {
        if (active) onFailure(vaultFailure(caught, "This item's history could not be loaded."))
      })
      .finally(() => {
        if (active) setVersionsSettled(true)
      })
    return () => {
      active = false
      setVersionsSettled(false)
    }
  }, [selectedKey, versionsByKey, onFailure, revision])

  useEffect(() => {
    if (section !== 'activity') return
    let active = true
    secretsApi
      .activity()
      .then((read) => {
        if (active) setActivity(read)
      })
      .catch((caught: unknown) => {
        if (active) onFailure(vaultFailure(caught, 'Vault activity could not be loaded.'))
      })
      .finally(() => {
        if (active) setActivitySettled(true)
      })
    return () => {
      active = false
      setActivitySettled(false)
    }
  }, [onFailure, section, revision])

  /** A saved item's history is stale the moment it is written — drop it so the next
   *  selection re-fetches rather than showing the version list from before the save. */
  const forgetVersions = useCallback((key: string) => {
    setVersions((current) => {
      const byKey = { ...current.byKey }
      delete byKey[key]
      return { ...current, byKey }
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
