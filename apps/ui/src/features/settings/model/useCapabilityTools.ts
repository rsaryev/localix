import { useMemo, useState } from 'react'
import type { CapabilitySnapshot, ToolSurfaceDenial } from '@/shared/api/contracts'
import { applyCapabilityRules } from '@/shared/contrib/capabilityCache'
import { availabilityChange } from '@/shared/contrib/capabilityRules'
import { useCapabilitySnapshot } from '@/shared/contrib/useCapabilitySnapshot'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { useCapabilityRegistry } from '@/shared/contrib/useCapabilityRegistry'

/** One catalog tool, with the scope's answer about it and the reason behind that answer. */
export interface CapabilityToolRow {
  name: string
  label: string
  description: string
  category: string
  /** The plugin that contributes it, when one does. */
  provider?: { id: string; label: string }
  enabled: boolean
  required?: boolean
  /**
   * Why it is off, when it is.
   *
   * `settings` is a rule someone wrote and a switch can lift. `capability` is structural —
   * the owning plugin is off, or the run shape does not carry the tool — and a switch here
   * would be a lie, so the row says so instead of offering one.
   */
  denial?: ToolSurfaceDenial
}

export interface CapabilityToolsData {
  tools: CapabilityToolRow[]
  /** Category id → label, in the order the backend put them. */
  categoryLabels: Record<string, string>
  loading: boolean
  error: string | null
  busy: string | null
  mutationError: string | null
  refresh: () => void
  setEnabled: (tool: CapabilityToolRow, enabled: boolean) => Promise<void>
}

const selectTools = (snapshot: CapabilitySnapshot): CapabilityToolRow[] => {
  const denials = new Map(snapshot.tools.disabled.map((entry) => [entry.name, entry]))
  return snapshot.tools.catalog.map((meta) => {
    const denial = denials.get(meta.name)
    return {
      name: meta.name,
      label: meta.label,
      description: meta.description,
      category: meta.category,
      ...(meta.provider ? { provider: { id: meta.provider.id, label: meta.provider.label } } : {}),
      enabled: !denial,
      required: meta.required,
      ...(denial ? { denial } : {}),
    }
  })
}

/**
 * The Tools tab's rows — the same registry shape the other three capability tabs use.
 *
 * Tools were the one kind with no list of their own: the tab showed the raw rule editor, so
 * the only way to find out whether an agent could run `bash` was to read its rules and
 * compose them in your head. They are a registry like any other now, and the switch writes
 * the same rule the editor would.
 *
 * The rows come from the SERVER's answer (`tools.catalog` minus `tools.disabled`), never from
 * a composition done here. A client that recomputed the verdict would be a second resolver,
 * free to disagree with the run — which is the failure the whole subsystem exists to prevent.
 */
export function useCapabilityTools(scope: string): CapabilityToolsData {
  const registry = useCapabilityRegistry(scope, selectTools)
  // The same shared document the registry reads, for the one field that is not a row.
  const { snapshot } = useCapabilitySnapshot(scope, useWorkItemVisible())
  const categoryLabels = useMemo(
    () => snapshot?.tools.categoryLabels ?? {},
    [snapshot?.tools.categoryLabels],
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [mutationError, setError] = useState<string | null>(null)

  const setEnabled = async (tool: CapabilityToolRow, enabled: boolean) => {
    setBusy(tool.name)
    registry.overlay((rows) =>
      rows.map((row) => (row.name === tool.name ? { ...row, enabled, denial: undefined } : row)),
    )
    setError(
      await registry.mutate(
        () => applyCapabilityRules(scope, [availabilityChange('tool', tool.name, enabled)]),
        `Could not ${enabled ? 'enable' : 'disable'} ${tool.label}.`,
      ),
    )
    setBusy(null)
  }

  return {
    tools: registry.rows,
    categoryLabels,
    loading: registry.loading,
    error: registry.error,
    busy,
    mutationError,
    refresh: registry.refresh,
    setEnabled,
  }
}
