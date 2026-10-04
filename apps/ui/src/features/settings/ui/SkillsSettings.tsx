import { useState } from 'react'
import type { Project, SkillInput, SkillRecord } from '@/shared/api/contracts'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { useSkills } from '../model/useSkills'
import { Button } from '@localixai/kit/button'
import { SettingProblems } from './settingRegistry'
import { SettingsActionActivity } from './SettingsActionActivity'
import { CapabilityIntro } from './capabilities/CapabilityIntro'
import { CapabilityRegistryBody } from './capabilities/CapabilityRegistryBody'
import { SkillForm, emptySkillDraft } from './capabilities/SkillForm'
import { SkillRow } from './capabilities/SkillRow'
import { ArchivedSkills } from './capabilities/ArchivedSkills'

interface SkillsSettingsProps {
  /** '' = no project; otherwise an exact project id. Drives the list and new-skill scope. */
  scope: string
  /** The agent whose rules a switch on this tab writes; `''` is the one that always exists. */
  agentScope?: string
  projects: Project[]
}

export function SkillsSettings({ scope, agentScope = '', projects }: SkillsSettingsProps) {
  const {
    skills,
    curatorByName,
    archived,
    loading,
    error,
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
  } = useSkills(scope, agentScope)
  // The draft being edited, or null when the editor is closed. Holding the draft
  // rather than a boolean is what makes "new skill" and "edit /foo" the same state.
  const [editing, setEditing] = useState<SkillInput | null>(null)

  // Glanceable roll-up: how many active skills have SKILL.md validation errors vs. only warnings.
  const errorCount = skills.filter((s) => (s.validation?.errors.length ?? 0) > 0).length
  const warningCount = skills.filter(
    (s) => !s.validation?.errors.length && (s.validation?.warnings.length ?? 0) > 0,
  ).length
  const actionsDisabled = Boolean(mutation) || curating

  return (
    <div className="w-full">
      <CapabilityIntro
        attention={{ errorCount, warningCount }}
        action={
          <>
            <Button
              variant="outline"
              onClick={() => void runCurator()}
              disabled={curating}
              title="Archive skills unused for a long time (pinned skills are skipped; archives are recoverable)"
              aria-busy={curating || undefined}
            >
              {curating ? <SettingsActionActivity label="Curating" /> : 'Run curator'}
            </Button>
            <Button variant="mono" onClick={() => setEditing(emptySkillDraft(scope || null))}>
              New skill
            </Button>
          </>
        }
      />

      {editing && (
        <SkillForm
          initial={editing}
          projects={projects}
          onSaved={() => {
            setEditing(null)
            refresh()
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      <SettingProblems
        className="mb-3"
        subject="Skills"
        errors={error && !editing ? [error] : []}
        onRetry={refresh}
      />

      <CapabilityRegistryBody
        count={skills.length}
        loading={loading}
        error={error}
        empty={
          <>
            No skills here yet. Create one with New skill, drop a <code>SKILL.md</code> in{' '}
            <code>.localix/skills/</code>, or ask the agent to save a procedure as a skill.
          </>
        }
      >
        {skills.map((s) => (
          <SkillRow
            key={s.id}
            skill={s}
            projects={projects}
            usage={curatorByName.get(s.name)}
            busyLabel={mutation?.name === s.name ? mutation.label : undefined}
            actionsDisabled={actionsDisabled}
            onToggle={() => void toggle(s)}
            onTogglePin={(usage) => void togglePin(usage)}
            onArchive={() => void archiveSkill(s.name)}
            // The body is read when the editor opens this skill, not carried in the
            // list: a catalog that ships every body grows with the user's writing.
            onEdit={() => {
              void loadSkill(s)
                .then((full: SkillRecord) =>
                  setEditing({
                    name: full.name,
                    description: full.description,
                    content: full.content,
                    projectId: full.projectId || null,
                  }),
                )
                .catch((error: unknown) => {
                  toast.error(`Could not open /${s.name}`, {
                    description: errorMessage(error, '') || undefined,
                  })
                })
            }}
            onDelete={() => void removeSkill(s)}
          />
        ))}
      </CapabilityRegistryBody>

      <ArchivedSkills
        archived={archived}
        mutationName={mutation?.name}
        mutationLabel={mutation?.label}
        actionsDisabled={actionsDisabled}
        onRestore={(name) => void restoreSkill(name)}
      />
    </div>
  )
}
