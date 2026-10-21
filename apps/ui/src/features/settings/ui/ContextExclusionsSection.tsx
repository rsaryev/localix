import { useState } from 'react'
import { Button } from '@localixai/kit/button'
import { Field } from '@localixai/kit/field'
import { Textarea } from '@localixai/kit/textarea'
import { contextExclusionsSchema } from '@localixai/api/context-exclusions'
import { useUserSettings } from '@/shared/lib/user-settings/useUserSettings'
import { SettingsSection } from './SettingsScaffold'

function ExclusionsForm({ paths }: { paths: string[] }) {
  const [text, setText] = useState(paths.join('\n'))
  const parsed = contextExclusionsSchema.safeParse([
    ...new Set(
      text
        .split('\n')
        .map((path) => path.trim())
        .filter(Boolean),
    ),
  ])
  const dirty = parsed.success && JSON.stringify(parsed.data) !== JSON.stringify(paths)
  const save = () => {
    if (!parsed.success) return
    const store = useUserSettings.getState()
    store.update({
      agentSettings: { ...store.settings.agentSettings, contextExclusions: parsed.data },
    })
  }
  return (
    <div className="space-y-3">
      <Field
        label="Excluded paths"
        description="One path per line, relative to each project's root. Use paths such as generated or private/local. Project exclusions also apply."
        error={
          !parsed.success
            ? 'Use up to 64 relative paths, at most 240 characters each. Absolute paths, backslashes and .. segments are not allowed.'
            : undefined
        }
      >
        <Textarea
          size="xl"
          className="min-h-28 resize-y font-mono"
          value={text}
          placeholder={'generated\nprivate/local'}
          onChange={(event) => setText(event.target.value)}
        />
      </Field>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          size="xl"
          variant="ghost"
          disabled={text === paths.join('\n')}
          onClick={() => setText(paths.join('\n'))}
        >
          Reset changes
        </Button>
        <Button size="xl" variant="mono" disabled={!dirty} onClick={save}>
          Apply exclusions
        </Button>
      </div>
    </div>
  )
}

export function ContextExclusionsSection() {
  const paths = useUserSettings((state) => state.settings.agentSettings.contextExclusions) ?? []
  return (
    <SettingsSection
      title="Context exclusions"
      anchor="system-context-exclusions"
      scope="workspace"
      description="Keep selected paths out of file context expansion. This does not restrict the agent's file tools; control those with permission rules."
    >
      <ExclusionsForm key={JSON.stringify(paths)} paths={paths} />
    </SettingsSection>
  )
}
