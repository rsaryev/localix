import { Pin } from 'lucide-react'
import type { CuratorSkillRecord, Project, SkillSummary } from '@/shared/api/contracts'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { Switch } from '@localixai/kit/switch'
import { settingsEntityUiUri } from '@localixai/plugin-sdk/navigation'
import { SettingProblems, SettingRegistryMeta, SettingRegistryRow } from '../settingRegistry'
import { relativeTime } from './skillCuratorTime'

/**
 * One active skill as a registry row: its slash name, where it is stored, the
 * curator's view of it (pinned / stale / usage), and its SKILL.md validation.
 *
 * Its own file because a skill row carries two independent verdicts — the
 * loader's (is this file valid?) and the curator's (is anyone using it?) — and
 * reading them as one line is exactly the confusion to avoid. Keeping them
 * beside each other here makes the distinction reviewable without scrolling
 * through the tab's list and form state.
 */
export function SkillRow({
  skill,
  projects,
  usage,
  busyLabel,
  actionsDisabled,
  onToggle,
  onTogglePin,
  onArchive,
  onEdit,
  onDelete,
}: {
  /** A CATALOG row: name, description, scope, hygiene — never the body. */
  skill: SkillSummary
  projects: Project[]
  /** Curator metadata for this skill, absent until the curator has seen it. */
  usage: CuratorSkillRecord | undefined
  busyLabel: string | undefined
  actionsDisabled: boolean
  /** May the scope's agent use this skill. Writes one `skill:<name>` rule. */
  onToggle: () => void
  onTogglePin: (usage: CuratorSkillRecord) => void
  onArchive: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const errors = skill.validation?.errors ?? []
  const warnings = skill.validation?.warnings ?? []
  // A problem outranks the switch: a skill with a broken SKILL.md is not simply "off", and a
  // reader scanning the column has to see the difference between the two.
  const state =
    errors.length > 0
      ? 'error'
      : warnings.length > 0 || usage?.state === 'stale'
        ? 'warning'
        : skill.enabled
          ? 'enabled'
          : 'disabled'

  return (
    <SettingRegistryRow
      uiTargetUri={settingsEntityUiUri('skills', 'skill', skill.name, skill.projectId)}
      state={state}
      busyLabel={busyLabel}
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
              items={[
                {
                  label:
                    skill.scope === 'global'
                      ? 'No project'
                      : (projects.find((p) => p.id === skill.projectId)?.name ?? 'Project'),
                },
                ...(usage?.pinned ? [{ label: 'Pinned' }] : []),
                ...(usage?.state === 'stale'
                  ? [
                      {
                        label: 'Stale',
                        tone: 'warning' as const,
                        title: 'Unused long enough that the next curator pass will archive it',
                      },
                    ]
                  : []),
              ]}
            />
          </div>
          <p
            className="mt-0.5 truncate text-sm text-text-soft"
            title={skill.description || undefined}
          >
            {skill.description}
          </p>
          {usage && (
            <p className="mt-0.5 text-2xs text-text-faint">
              Used {usage.getCount}× · last {relativeTime(usage.lastUsedAt)}
            </p>
          )}
        </>
      }
      toggle={
        <Switch
          checked={skill.enabled}
          disabled={actionsDisabled}
          onChange={onToggle}
          aria-label={`${skill.enabled ? 'Disable' : 'Enable'} /${skill.name}`}
        />
      }
      actions={
        <>
          {usage && (
            <IconButton
              size="md"
              onClick={() => onTogglePin(usage)}
              disabled={actionsDisabled}
              aria-label={
                usage.pinned
                  ? `Unpin /${skill.name} and allow automatic archiving`
                  : `Pin /${skill.name} to prevent automatic archiving`
              }
              tooltip={
                usage.pinned
                  ? 'Unpin — allow the curator to auto-archive when stale'
                  : 'Pin — never auto-archive this skill'
              }
              className={cn(usage.pinned && 'text-foreground')}
            >
              <Pin className={cn(usage.pinned && 'fill-current')} />
            </IconButton>
          )}
          <Button variant="ghost" size="default" onClick={onArchive} disabled={actionsDisabled}>
            Archive
          </Button>
          <Button variant="ghost" size="default" onClick={onEdit} disabled={actionsDisabled}>
            Edit
          </Button>
          <Button
            variant="destructive"
            size="default"
            onClick={onDelete}
            disabled={actionsDisabled}
          >
            Delete
          </Button>
        </>
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
