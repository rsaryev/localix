import type { CuratorSkillRecord } from '@/shared/api/contracts'
import { Button } from '@localixai/kit/button'
import { SettingRegistryList, SettingRegistryRow } from '../settingRegistry'
import { relativeTime } from './skillCuratorTime'
import { SettingsSection } from '../SettingsScaffold'

/**
 * The archive that sits under the active skill list.
 *
 * Kept as its own block, and its own file, because it is a different claim: an
 * archived skill is not a broken or disabled one, it is a file the curator moved
 * aside and can move back. Rendering it through the same registry row keeps the
 * two readable as one page; stating it separately keeps the active list from
 * inheriting the archive's quieter treatment.
 */
export function ArchivedSkills({
  archived,
  mutationName,
  mutationLabel,
  actionsDisabled,
  onRestore,
}: {
  archived: CuratorSkillRecord[]
  /** Skill currently being mutated, if any — its row shows the activity orb. */
  mutationName: string | undefined
  mutationLabel: string | undefined
  actionsDisabled: boolean
  onRestore: (name: string) => void
}) {
  if (archived.length === 0) return null

  return (
    <SettingsSection
      title={`Archived skills (${archived.length})`}
      description="Moved to the skills folder’s .archive/ by you or the curator. Restore brings the file back."
    >
      <SettingRegistryList>
        {archived.map((c) => (
          <SettingRegistryRow
            key={`${c.scope}:${c.name}`}
            state="neutral"
            busyLabel={mutationName === c.name ? mutationLabel : undefined}
            header={
              <>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <code className="text-sm text-text-soft">/{c.name}</code>
                  <span className="text-2xs text-text-faint">
                    archived {relativeTime(c.archivedAt)} · used {c.getCount}×
                  </span>
                </div>
                {c.description && (
                  <p className="mt-0.5 truncate text-xs text-text-faint" title={c.description}>
                    {c.description}
                  </p>
                )}
              </>
            }
            actions={
              <Button
                variant="ghost"
                size="default"
                onClick={() => onRestore(c.name)}
                disabled={actionsDisabled}
              >
                Restore
              </Button>
            }
          />
        ))}
      </SettingRegistryList>
    </SettingsSection>
  )
}
