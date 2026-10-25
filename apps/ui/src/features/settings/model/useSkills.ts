import { useState } from 'react'
import { toast } from '@/shared/lib/notify'

import { backendClient } from '@/shared/api/client'
import type { SkillSummary } from '@/shared/api/contracts'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { trackCapabilityWrite } from '@/shared/contrib/capabilityWrites'
import { applyCapabilityRules } from '@/shared/contrib/capabilityCache'
import { availabilityChange } from '@/shared/contrib/capabilityRules'
import { useCapabilityRegistry } from '@/shared/contrib/useCapabilityRegistry'

export interface SkillsData {
  /** Catalog rows, no bodies: a skill is written, edited and archived on its Store page. */
  skills: SkillSummary[]
  loading: boolean
  error: string | null
  /** True while the curator sweep is running. */
  curating: boolean
  /** The skill whose switch is writing, for the row's busy state. */
  switching: string | null
  refresh: () => void
  /**
   * May this scope's agent USE the skill: the switch the other registries have, writing the
   * same kind of rule (`skill:<name>`). Archiving and pinning are the Store page's.
   */
  toggle: (s: SkillSummary) => Promise<void>
  runCurator: () => Promise<void>
}

/**
 * The skills of a scope (project id or '' = no project) and their switches. The list is projected
 * from the scope's capability document, like every other capability registry: summaries only.
 */
export function useSkills(scope: string, agentScope = ''): SkillsData {
  const registry = useCapabilityRegistry(scope, (snapshot) => snapshot.skills)
  const [error, setError] = useState<string | null>(null)
  const [curating, setCurating] = useState(false)
  const [switching, setSwitching] = useState<string | null>(null)

  const registryRefresh = registry.refresh
  const refresh = () => {
    setError(null)
    registryRefresh()
  }

  /**
   * The switch, as a rule. The row flips optimistically, the document that comes back replaces
   * the overlay, and a refusal lands in this screen's problem line.
   */
  const toggle = async (s: SkillSummary) => {
    setSwitching(s.name)
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
    setSwitching(null)
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

  return {
    skills: registry.rows,
    loading: registry.loading,
    error: error ?? (registry.error ? 'Could not load the skills.' : null),
    curating,
    switching,
    refresh,
    toggle,
    runCurator,
  }
}
