import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { SecretMeta } from '@localixai/api/client'
import type { Problem } from '@localixai/mini-app-sdk/ui/problems'
import { secretsApi } from '@/shared/api/secretsApi'
import { useResourceRevision } from '@/shared/api/useResourceRevision'
import { createMessageBindingDraft } from '@localixai/mini-app-sdk/ui/message-binding-drag'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { registerUiTarget } from '@/shared/lib/uiTargetRegistry'
import { useProblemReport } from '@/shared/ui/problem-report'
import { vaultItemResourceUri } from './vaultResource'
import { selectionAfterVaultRefresh } from './vaultSelection'
import { useVaultCollections } from './useVaultCollections'
import { useVaultDeletion } from './useVaultDeletion'
import { VAULT_PROBLEM_SCOPE, vaultFailure } from './vaultProblem'
import type { SourceFilter, TypeFilter, VaultSection } from './vaultSections'
import { COPIED_FEEDBACK_MS } from '@/shared/lib/timings'

/**
 * THE VAULT LIST — its load, its filters, its selection, and the ONE problem report the Vault's
 * subject has.
 *
 * The report ownership is the reason this hook exists at the size it does. Both surfaces that
 * can show a Vault failure — the toolbar line and the empty pane — read it from here, so they
 * say the same thing and cannot settle each other's Event Center row. Anything this hook
 * delegates therefore reports back INTO `setError` (see `useVaultCollections`) or keeps a local,
 * dialog-scoped error of its own (`useVaultDeletion`); nothing else publishes the subject.
 *
 * `consequence` is decided here for the same reason: only this hook knows whether the list has
 * content. A failure with an empty list is `blocked` (there is nothing to look at); a failure
 * over a list that loaded is `stale` (what is on screen is just older than the server).
 */
export function useVaultWorkspace(requestedKey?: string) {
  const revision = useResourceRevision('vault')
  const [items, setItems] = useState<SecretMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<Problem | null>(null)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [section, setSection] = useState<VaultSection>('items')
  const [selectedKey, setSelectedKey] = useState<string | null>(requestedKey ?? null)
  const [editor, setEditor] = useState<'create' | 'edit' | 'rotate' | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const targetCleanups = useRef(new Map<string, () => void>())
  const readGeneration = useRef(0)
  const bindTarget = useCallback((key: string, element: HTMLButtonElement | null) => {
    targetCleanups.current.get(key)?.()
    targetCleanups.current.delete(key)
    if (element) {
      targetCleanups.current.set(key, registerUiTarget(vaultItemResourceUri(key), element))
    }
  }, [])
  useEffect(
    () => () => {
      targetCleanups.current.forEach((unregister) => unregister())
      targetCleanups.current.clear()
    },
    [],
  )

  // Reads the list for one generation; a newer read (or the cleanup of the effect that asked)
  // retires it, so a slow answer never lands over a fresher one.
  const settle = useCallback(
    async (generation: number) => {
      try {
        const next = await secretsApi.list()
        if (generation !== readGeneration.current) return
        setItems(next)
        setSelectedKey((current) => selectionAfterVaultRefresh(next, current, requestedKey))
      } catch (caught) {
        if (generation !== readGeneration.current) return
        setError(vaultFailure(caught, 'The Vault could not be loaded.'))
      } finally {
        if (generation === readGeneration.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [requestedKey],
  )

  /** A read the person (or a write) asks for: `quiet` keeps the list on screen while it runs. */
  const refresh = useCallback(
    async (quiet = false) => {
      const generation = ++readGeneration.current
      if (quiet) setRefreshing(true)
      else setLoading(true)
      setError(null)
      await settle(generation)
    },
    [settle],
  )

  // The read the vault's revision (and the requested key) ask for. Its cleanup retires the
  // answer in flight and puts the next read back to "loading", with no failure left over.
  useEffect(() => {
    const generations = readGeneration
    void settle(++generations.current)
    return () => {
      generations.current++
      setLoading(true)
      setError(null)
    }
  }, [settle, revision])

  // A different key asked for from outside (a link, a command) selects it.
  const [seenRequestedKey, setSeenRequestedKey] = useState(requestedKey)
  if (seenRequestedKey !== requestedKey) {
    setSeenRequestedKey(requestedKey)
    if (requestedKey) setSelectedKey(requestedKey)
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return items.filter((item) => {
      if (typeFilter !== 'all' && item.type !== typeFilter) return false
      if (sourceFilter !== 'all' && item.source !== sourceFilter) return false
      if (!needle) return true
      return `${item.label} ${item.key} ${item.description ?? ''} ${item.tags.join(' ')}`
        .toLocaleLowerCase()
        .includes(needle)
    })
  }, [items, query, sourceFilter, typeFilter])

  const selected = items.find((item) => item.key === selectedKey)
  // The item being edited or rotated was removed (elsewhere, by an agent): its dialog closes
  // rather than going on with a blank form for something that is gone.
  if ((editor === 'edit' || editor === 'rotate') && !loading && !selected) setEditor(null)
  const personalCount = items.filter((item) => item.source === 'user').length
  const managedCount = items.length - personalCount

  const {
    activity,
    bindingsByKey,
    forgetVersions,
    loadingActivity,
    loadingUsage,
    loadingVersions,
    totalConsumers,
    versionsByKey,
  } = useVaultCollections(items, section, selectedKey, setError)

  const {
    beginDelete,
    confirmDelete,
    deleteBindings,
    deleteError,
    deleteTarget,
    deleting,
    loadingDeleteBindings,
    setDeleteTarget,
  } = useVaultDeletion(refresh)

  const copyReference = async (item: SecretMeta, template = false) => {
    if (!item.reference) return
    const value = template ? `\${${item.reference}}` : item.reference
    try {
      if (!(await platformCapabilities().clipboard.writeText(value))) {
        throw new Error('Clipboard unavailable')
      }
      setCopied(`${item.key}:${template ? 'template' : 'handle'}`)
      window.setTimeout(() => setCopied(null), COPIED_FEEDBACK_MS)
    } catch {
      setError({ severity: 'error', message: 'The clipboard is not available in this window.' })
    }
  }

  const saveItem = (saved: SecretMeta) => {
    setItems((current) => {
      const without = current.filter((item) => item.id !== saved.id)
      return [saved, ...without]
    })
    forgetVersions(saved.key)
    setSelectedKey(saved.key)
  }

  const bindingFor = (item: SecretMeta) =>
    createMessageBindingDraft('resource', vaultItemResourceUri(item.key), item.label)
  const loadFailed = !loading && items.length === 0 && error !== null
  const problem = useProblemReport(
    error
      ? {
          subject: { label: 'Vault' },
          problems: [error],
          consequence: loadFailed ? 'blocked' : 'stale',
        }
      : null,
    {
      scope: VAULT_PROBLEM_SCOPE,
      sourceVisible: true,
      // Dismiss only where the pane still shows something: clearing the line off a Vault that
      // never loaded would leave an empty pane and no reason for it. It is surface-only either
      // way — "stop showing me this" says nothing to a durable row read an hour later.
      actions: loadFailed
        ? [{ id: 'retry', label: 'Retry', run: () => refresh() }]
        : [
            { id: 'retry', label: 'Retry', run: () => refresh() },
            { id: 'dismiss', label: 'Dismiss', run: () => setError(null), durable: false },
          ],
    },
  )

  return {
    activity,
    beginDelete,
    bindTarget,
    bindingFor,
    bindingsByKey,
    confirmDelete,
    copied,
    copyReference,
    deleteBindings,
    deleteError,
    deleteTarget,
    deleting,
    editor,
    error,
    filtered,
    items,
    loadFailed,
    loading,
    loadingActivity,
    loadingDeleteBindings,
    loadingUsage,
    loadingVersions,
    managedCount,
    problem,
    query,
    refresh,
    refreshing,
    saveItem,
    section,
    selected,
    selectedKey,
    setDeleteTarget,
    setEditor,
    setError,
    setQuery,
    setSection,
    setSelectedKey,
    setSourceFilter,
    setTypeFilter,
    sourceFilter,
    totalConsumers,
    typeFilter,
    versionsByKey,
  }
}
