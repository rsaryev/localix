import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@/shared/lib/notify'

import { backendClient } from '@/shared/api/client'
import type { CuratorSkillRecord, SkillRecord, SkillSummary } from '@/shared/api/contracts'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { usePluginContribVersion } from '@/shared/contrib/usePluginContribVersion'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { trackCapabilityWrite } from '@/shared/contrib/capabilityWrites'
import { applyCapabilityRules } from '@/shared/contrib/capabilityCache'
import { availabilityChange } from '@/shared/contrib/capabilityRules'
import { useCapabilityRegistry } from '@/shared/contrib/useCapabilityRegistry'

export interface SkillsData {
  /** Catalog rows — no bodies. `loadSkill` fetches one when the editor opens it. */
  skills: SkillSummary[]
  /** Curator metadata (pin/archive state, usage) keyed alongside the skill list. */
  curator: CuratorSkillRecord[]
  curatorByName: Map<string, CuratorSkillRecord>
  archived: CuratorSkillRecord[]
  loading: boolean
  error: string | null
  /** True while the curator sweep is running. */
  curating: boolean
  /** Per-skill mutation currently running, used for stable row activity feedback. */
  mutation: SkillMutation | null
  refresh: () => void
  /**
   * May this scope's agent USE the skill — the same switch the other three registries have,
   * writing the same kind of rule (`skill:<name>`).
   *
   * Distinct from the curator's verbs beside it, and the row keeps both: archiving retires a
   * skill for everyone, pinning protects it from being retired, and this says whether one agent
   * may reach for it. They were a single question only for as long as skills had no switch at
   * all — which is why the only way to deny one used to be to write the rule by hand.
   */
  toggle: (s: SkillSummary) => Promise<void>
  togglePin: (c: CuratorSkillRecord) => Promise<void>
  archiveSkill: (name: string) => Promise<void>
  restoreSkill: (name: string) => Promise<void>
  runCurator: () => Promise<void>
  removeSkill: (s: SkillSummary) => Promise<void>
  /** Read ONE skill in full, for the editor. Rejects with the backend failure. */
  loadSkill: (s: SkillSummary) => Promise<SkillRecord>
}

interface SkillMutation {
  name: string
  label: string
}

/**
 * Skills list + curator data for a given scope (project id or '' = no project).
 *
 * The list is projected from the scope's capability document, like every other
 * capability registry — summaries only. Curator metadata (pins, usage, archives) is
 * its own read, because it is not a capability: it describes how a skill has been
 * USED, and it belongs to this screen alone. The editor's body comes from
 * `loadSkill`, one skill at a time.
 */
export function useSkills(scope: string, agentScope = ''): SkillsData {
  const pluginContribVersion = usePluginContribVersion()
  const workItemVisible = useWorkItemVisible()
  const registry = useCapabilityRegistry(scope, (snapshot) => snapshot.skills)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [curator, setCurator] = useState<CuratorSkillRecord[]>([])
  const [curating, setCurating] = useState(false)
  const [mutation, setMutation] = useState<SkillMutation | null>(null)
  const mutationRef = useRef<SkillMutation | null>(null)

  // `registry.refresh` changes only with the scope; an empty list kept the first scope's
  // refresh, so a retry after switching scopes re-read the wrong one.
  const registryRefresh = registry.refresh
  const refresh = useCallback(() => {
    setError(null)
    registryRefresh()
    setRefreshKey((key) => key + 1)
  }, [registryRefresh])

  // Only the curator half is fetched here — pins, usage and archives describe how a
  // skill has been USED, which is this screen's business and no run's.
  useEffect(() => {
    if (!workItemVisible) return
    let cancelled = false
    backendClient
      .listCuratorSkills({ projectId: scope || null })
      .then((rows) => {
        if (!cancelled) setCurator(rows)
      })
      .catch(() => {
        /* curator info is decorative — the list still works without it */
      })
    return () => {
      cancelled = true
    }
  }, [scope, refreshKey, pluginContribVersion, workItemVisible])

  /** Read ONE skill in full — the editor's body, fetched when it is actually opened. */
  const loadSkill = useCallback(
    (skill: SkillSummary) =>
      backendClient.getSkill(skill.name, { projectId: skill.projectId || null }),
    [],
  )

  const curatorByName = new Map(curator.map((c) => [c.name, c]))
  const archived = curator.filter((c) => c.state === 'archived')

  const runSkillMutation = async ({
    name,
    label,
    action,
    errorFallback,
    onSuccess,
  }: {
    name: string
    label: string
    action: () => Promise<unknown>
    errorFallback: string
    onSuccess?: () => void
  }) => {
    if (mutationRef.current) return
    const next = { name, label }
    mutationRef.current = next
    setMutation(next)
    try {
      await trackCapabilityWrite(scope || null, action)
      onSuccess?.()
      refresh()
    } catch (e) {
      toast.error(errorFallback, { description: errorMessage(e, '') || undefined })
    } finally {
      mutationRef.current = null
      setMutation(null)
    }
  }

  /**
   * The switch, as a rule — the plugin list's toggle, one kind over.
   *
   * It does NOT go through `runSkillMutation`: that one refreshes the curator read and pops a
   * toast, which is right for archiving a file and wrong for a decision the user will make five
   * times in a row. The row flips optimistically, the document that comes back replaces the
   * overlay, and a refusal lands in this screen's problem line.
   */
  const toggle = async (s: SkillSummary) => {
    setMutation({ name: s.name, label: `${s.enabled ? 'Disabling' : 'Enabling'} /${s.name}` })
    registry.overlay((rows) =>
      rows.map((row) =>
        row.name === s.name && row.projectId === s.projectId
          ? { ...row, enabled: !row.enabled }
          : row,
      ),
    )
    setError(
      await registry.mutate(
        () => applyCapabilityRules(agentScope, [availabilityChange('skill', s.name, !s.enabled)]),
        'Could not turn this skill on or off.',
      ),
    )
    setMutation(null)
  }

  const togglePin = async (c: CuratorSkillRecord) => {
    await runSkillMutation({
      name: c.name,
      label: `${c.pinned ? 'Unpinning' : 'Pinning'} /${c.name}`,
      action: () =>
        backendClient.setSkillPinned(c.name, c.scope, !c.pinned, { projectId: scope || null }),
      errorFallback: `Could not ${c.pinned ? 'unpin' : 'pin'} “/${c.name}”`,
    })
  }

  const archiveSkill = async (name: string) => {
    await runSkillMutation({
      name,
      label: `Archiving /${name}`,
      action: () => backendClient.archiveSkill(name, { projectId: scope || null }),
      // No success row: the skill moves to the Archived section right where it was archived.
      errorFallback: `Could not archive “/${name}”`,
    })
  }

  const restoreSkill = async (name: string) => {
    await runSkillMutation({
      name,
      label: `Restoring /${name}`,
      action: () => backendClient.restoreSkill(name, { projectId: scope || null }),
      // No success row: the skill leaves the Archived section on the screen that restored it.
      errorFallback: `Could not restore “/${name}”`,
    })
  }

  const runCurator = async () => {
    setCurating(true)
    try {
      const report = await trackCapabilityWrite(scope || null, () =>
        backendClient.runSkillsCurator({ projectId: scope || null }),
      )
      const archivedNow = report.archivedNow.length
      toast.success('Curator run finished', {
        description:
          archivedNow === 0
            ? `Nothing stale: ${report.active} active, ${report.archived} archived.`
            : `Archived ${archivedNow} stale ${archivedNow === 1 ? 'skill' : 'skills'}: ${report.archivedNow.join(', ')}.`,
      })
      refresh()
    } catch (e) {
      toast.error('Could not run the curator', {
        description: errorMessage(e, '') || undefined,
      })
    } finally {
      setCurating(false)
    }
  }

  const removeSkill = async (s: SkillSummary) => {
    await runSkillMutation({
      name: s.name,
      label: `Deleting /${s.name}`,
      action: () => backendClient.deleteSkill(s.name, s.projectId || null),
      errorFallback: `Could not delete “/${s.name}”`,
    })
  }

  return {
    skills: registry.rows,
    curator,
    curatorByName,
    archived,
    loading: registry.loading,
    error: error ?? (registry.error ? 'Could not load the skills.' : null),
    curating,
    mutation,
    refresh,
    toggle,
    togglePin,
    archiveSkill,
    restoreSkill,
    runCurator,
    removeSkill,
    loadSkill,
  }
}
