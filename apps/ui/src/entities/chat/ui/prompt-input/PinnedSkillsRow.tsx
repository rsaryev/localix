import { Chip } from '@localixai/kit/chip'
import { ChipRemoveButton } from './ChipRemoveButton'

/**
 * Applied (pinned) skills — warmed into the session, not run. Each chip removes
 * itself from the pinned set on click. Rendered above the composer textarea.
 */
export function PinnedSkillsRow({
  skills,
  onChange,
}: {
  skills: string[]
  onChange: (next: string[]) => void
}) {
  if (skills.length === 0) return null
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1.5 px-3.5 max-sm:px-2.5">
      {skills.map((name) => (
        <Chip key={name} tone="neutral" className="gap-1">
          /{name}
          <ChipRemoveButton
            label={`Remove /${name}`}
            onRemove={() => onChange(skills.filter((n) => n !== name))}
          />
        </Chip>
      ))}
    </div>
  )
}
