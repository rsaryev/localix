import type { Project, SkillSummary } from '@/shared/api/contracts'
import { Button } from '@localixai/kit/button'
import { openStore } from '@/shared/lib/openStore'
import { useSkills } from '../model/useSkills'
import { SettingProblems } from './settingRegistry'
import { SettingsActionActivity } from './SettingsActionActivity'
import { SettingsSection } from './SettingsScaffold'
import { AttentionRollup } from './AttentionRollup'
import { CapabilityRegistryBody } from './capabilities/CapabilityRegistryBody'
import { SkillRow } from './capabilities/SkillRow'

interface SkillsSettingsProps {
  /** '' = no project; otherwise an exact project id. Drives the list. */
  scope: string
  /** The agent whose rules a switch on this tab writes; `''` is the one that always exists. */
  agentScope?: string
  projects: Project[]
}

/** A skill's page in the Store; a plugin's skill has none, it follows its plugin. */
const storeIdOf = (skill: SkillSummary): string | null =>
  skill.id.startsWith('plugin:')
    ? null
    : skill.scope === 'project'
      ? `project:${skill.name}`
      : `user:${skill.name}`

/** Settings → Capabilities → Skills: whether the agent may use each skill. Skills live in the Store. */
export function SkillsSettings({ scope, agentScope = '', projects }: SkillsSettingsProps) {
  const { skills, loading, error, curating, switching, refresh, toggle, runCurator } = useSkills(
    scope,
    agentScope,
  )

  // Glanceable roll-up: how many skills have SKILL.md validation errors vs. only warnings.
  const errorCount = skills.filter((s) => (s.validation?.errors.length ?? 0) > 0).length
  const warningCount = skills.filter(
    (s) => !s.validation?.errors.length && (s.validation?.warnings.length ?? 0) > 0,
  ).length

  return (
    <div className="w-full space-y-8">
      <SettingsSection
        title="Skills"
        description="Whether the selected agent may use each skill. A skill is written, edited, pinned, archived and removed on its Store page."
        actions={
          <>
            <AttentionRollup errorCount={errorCount} warningCount={warningCount} />
            <Button
              size="xl"
              variant="outline"
              onClick={() => void runCurator()}
              disabled={curating}
              title="Archive skills unused for a long time (pinned skills are skipped; archives are recoverable)"
              aria-busy={curating || undefined}
            >
              {curating ? <SettingsActionActivity label="Curating" /> : 'Run curator'}
            </Button>
            <Button size="xl" variant="mono" onClick={() => openStore({ shelf: 'yours' })}>
              Open in the Store
            </Button>
          </>
        }
      >
        <SettingProblems
          className="mb-3"
          subject="Skills"
          errors={error ? [error] : []}
          onRetry={refresh}
        />

        <CapabilityRegistryBody
          count={skills.length}
          loading={loading}
          error={error}
          empty={
            <>
              No skills here yet. Add one from Library → Yours in the Store, with Add skill, or ask
              the agent to save a procedure as a skill.
            </>
          }
        >
          {skills.map((s) => {
            const id = storeIdOf(s)
            return (
              <SkillRow
                key={s.id}
                skill={s}
                projects={projects}
                busy={switching === s.name}
                onToggle={() => void toggle(s)}
                onOpen={id ? () => openStore({ ref: { kind: 'skill', id } }) : undefined}
              />
            )
          })}
        </CapabilityRegistryBody>
      </SettingsSection>
    </div>
  )
}
