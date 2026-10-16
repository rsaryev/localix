import { backendClient } from '@/shared/api/client'
import type { AgentSummary, AgentRecordInput } from '@/shared/api/contracts'
import { applyCapabilityRules } from '@/shared/contrib/capabilityCache'
import { availabilityChange } from '@/shared/contrib/capabilityRules'
import { trackCapabilityWrite } from '@/shared/contrib/capabilityWrites'
import { acknowledgeInline } from '@/shared/lib/notifications/inlineReport'
import { useCapabilityRegistry } from './useCapabilityRegistry'
import { useRegistryScope } from './useRegistryScope'

export interface AgentsData {
  agents: AgentSummary[]
  loading: boolean
  error: string | null
  /** Agent name currently mutating (toggle/create/save/delete), for per-row busy UI. */
  busy: string | null
  busyLabel: string | null
  refresh: () => void
  toggle: (a: AgentSummary) => Promise<void>
  /**
   * Creates a record and refreshes the registry; rejects with the backend failure.
   *
   * It ANSWERS with the created summary because the draft the user filled in has no id until
   * this returns, and its profile tab has to become that record's — deriving the id from the
   * handle instead would be a second, guessing copy of what the server just decided.
   */
  create: (input: AgentRecordInput) => Promise<AgentSummary>
  /** Replaces one record's definition (the name is immutable); rejects with the backend failure. */
  update: (a: AgentSummary, input: AgentRecordInput) => Promise<AgentSummary>
  /** Removes the definition file(s) and the enable row. */
  remove: (a: AgentSummary) => Promise<void>
  /** Copies a record under a new name in the same scope. */
  duplicate: (a: AgentSummary, newName: string) => Promise<void>
  /** Drops the user's override of a system agent so the shipped definition applies again. */
  reset: (a: AgentSummary) => Promise<void>
}

/**
 * Managed-Agents registry list + mutations for a given scope (project id or '' =
 * global), with an optimistic enable toggle and the record verbs.
 *
 * List, loading, error and the optimistic overlay all come from
 * {@link ./useCapabilityRegistry useCapabilityRegistry} — the same projection the
 * plugin and MCP lists use, so the three cannot drift apart. What is
 * left here is what is genuinely this registry's own: what a row is called while it is
 * busy, and how a record is written.
 */
export function useAgents(scope: string): AgentsData {
  const registry = useCapabilityRegistry(scope, (snapshot) => snapshot.agents)
  const { error, setError, busy, busyLabel, setBusy } = useRegistryScope()

  const refresh = () => {
    setError(null)
    registry.refresh()
  }

  const toggle = async (a: AgentSummary) => {
    const name = a.record.handle
    setBusy(a.record.id, `${a.enabled ? 'Disabling' : 'Enabling'} ${a.record.label || name}`)
    // Optimistic flip so the toggle feels instant. The toggle registers itself with the
    // write barrier, so there is nothing to wrap here — see capabilityWrites.
    registry.overlay((prev) =>
      prev.map((x) => (x.record.id === a.record.id ? { ...x, enabled: !x.enabled } : x)),
    )
    setError(
      await registry.mutate(
        () =>
          applyCapabilityRules(a.projectId || '', [
            availabilityChange('agent', a.record.id, !a.enabled),
          ]),
        `Could not ${a.enabled ? 'disable' : 'enable'} ${name}.`,
      ),
    )
    setBusy(null)
  }

  /**
   * Every record write follows one shape: name the busy row, run the write inside the
   * capability write barrier (so the list the user sees is the list the next run gets),
   * refresh, release. The caller keeps the rejection — a form shows it beside its fields,
   * a row shows it in the list's problem line.
   */
  const write = async <T>(name: string, label: string, run: () => Promise<T>): Promise<T> => {
    setBusy(name, label)
    try {
      const result = await trackCapabilityWrite(scope || null, run)
      refresh()
      return result
    } finally {
      setBusy(null)
    }
  }

  const create = (input: AgentRecordInput) =>
    write(input.handle, `Creating ${input.label || input.handle}`, () =>
      backendClient.createAgent({ ...input, projectId: scope || null }),
    )

  const update = (a: AgentSummary, input: AgentRecordInput) =>
    write(a.record.id, `Saving ${input.label || a.record.handle}`, () =>
      backendClient.updateAgent(a.record.id, input, a.projectId || null),
    )

  /** A row action's failure lands in the list's problem line, never as an unhandled rejection. */
  const rowAction = async (a: AgentSummary, label: string, run: () => Promise<unknown>) => {
    try {
      await write(a.record.id, `${label} ${a.record.label || a.record.handle}`, run)
    } catch (cause) {
      acknowledgeInline(cause)
      setError(
        cause instanceof Error
          ? cause.message
          : `Could not ${label.toLowerCase()} ${a.record.handle}.`,
      )
    }
  }

  const remove = (a: AgentSummary) =>
    rowAction(a, 'Deleting', () => backendClient.deleteAgent(a.record.id, a.projectId || null))

  const duplicate = (a: AgentSummary, newName: string) =>
    rowAction(a, 'Duplicating', () =>
      backendClient.duplicateAgent(a.record.id, newName, a.projectId || null),
    )

  const reset = async (a: AgentSummary) => {
    await write(a.record.id, `Restoring ${a.record.label || a.record.handle}`, () =>
      backendClient.resetAgent(a.record.id, a.projectId || null),
    )
  }

  return {
    agents: registry.rows,
    loading: registry.loading,
    error: error ?? registry.error,
    busy,
    busyLabel,
    refresh,
    toggle,
    create,
    update,
    remove,
    duplicate,
    reset,
  }
}
