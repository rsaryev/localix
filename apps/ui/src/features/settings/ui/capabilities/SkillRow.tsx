import type { Project, SkillSummary } from '@/shared/api/contracts'
import { projectScopeLabel } from '@/shared/lib/projectScope'
import { Button } from '@localixai/kit/button'
import { Switch } from '@localixai/kit/switch'
import { settingsEntityUiUri } from '@localixai/mini-app-sdk/navigation'
import { SettingProblems, SettingRegistryMeta, SettingRegistryRow } from '../settingRegistry'

/**
 * One skill as a registry row: its slash name, where it is kept, its SKILL.md validation, whether
 * the agent may use it, and the way to its Store page, where it is edited, archived and removed.
 * A plugin's skill has no page of its own: it follows its plugin.
 */
export function SkillRow({
  skill,
  projects,
  busy,
  onToggle,
  onOpen,
}: {
  /** A CATALOG row: name, description, scope, hygiene — never the body. */
  skill: SkillSummary
  projects: Project[]
  busy: boolean
  /** May the scope's agent use this skill. Writes one `skill:<name>` rule. */
  onToggle: () => void
  /** Absent for a skill that has no Store page. */
  onOpen: (() => void) | undefined
}) {
  const errors = skill.validation?.errors ?? []
  const warnings = skill.validation?.warnings ?? []
  // A problem outranks the switch: a skill with a broken SKILL.md is not simply "off".
  const state =
    errors.length > 0
      ? 'error'
      : warnings.length > 0
        ? 'warning'
        : skill.enabled
          ? 'enabled'
          : 'disabled'

  return (
    <SettingRegistryRow
      uiTargetUri={settingsEntityUiUri('skills', 'skill', skill.name, skill.projectId)}
      state={state}
      busyLabel={busy ? `Switching /${skill.name}` : undefined}
      header={
        <>
          <div className="min-w-0">
            <code
              className="block min-w-0 max-w-full truncate text-sm font-medium text-foreground"
              title={`/${skill.name}`}
            >
              /{skill.name}
            </code>
            <SettingRegistryMeta
              items={[{ label: projectScopeLabel(projects, skill.projectId) }]}
            />
          </div>
          <p
            className="mt-0.5 truncate text-sm text-text-soft"
            title={skill.description || undefined}
          >
            {skill.description}
          </p>
        </>
      }
      toggle={
        <Switch
          checked={skill.enabled}
          disabled={busy}
          onChange={onToggle}
          aria-label={`${skill.enabled ? 'Disable' : 'Enable'} /${skill.name}`}
        />
      }
      actions={
        onOpen && (
          <Button variant="ghost" size="default" onClick={onOpen}>
            Settings
          </Button>
        )
      }
    >
      <SettingProblems
        className="mt-2 ml-5"
        subject={`/${skill.name}`}
        errors={errors}
        warnings={warnings}
      />
    </SettingRegistryRow>
  )
}
