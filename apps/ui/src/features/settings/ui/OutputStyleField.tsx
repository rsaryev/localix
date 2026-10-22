import { useEffect, useState } from 'react'
import { Select, type SelectOption } from '@localixai/kit/select'

import { backendClient } from '@/shared/api/client'
import { useUserSettings } from '@/shared/lib/user-settings/useUserSettings'
import { SettingsSection } from './SettingsScaffold'

type OutputStyleSummary = Awaited<ReturnType<typeof backendClient.listOutputStyles>>[number]

/** The option for no style; never a style's name, which `default` cannot be. */
const DEFAULT_VALUE = 'default'

const SOURCE_LABEL: Record<OutputStyleSummary['source'], string> = {
  builtin: 'Built-in',
  user: 'Yours',
  project: 'Project',
  plugin: 'Plugin',
}

/**
 * Default, then every style the global scope offers. A stored name nothing offers here — a
 * project's own style, a disabled plugin's — stays listed so the field still shows what is saved.
 */
export function outputStyleOptions(
  styles: readonly OutputStyleSummary[],
  current: string | undefined,
): SelectOption[] {
  const options: SelectOption[] = [
    { value: DEFAULT_VALUE, label: 'Default', description: 'No style instructions' },
    ...styles
      .filter((style) => !style.forced)
      .map((style) => ({
        value: style.name,
        label: style.name,
        description: [SOURCE_LABEL[style.source], style.description].filter(Boolean).join(' · '),
      })),
  ]
  if (current && !options.some((option) => option.value === current))
    options.push({ value: current, label: current, description: 'Not offered here' })
  return options
}

/**
 * The output style every chat starts in, as Claude Code's `outputStyle` setting: a chat's own
 * `/output-style` choice still wins, and a plugin's forced style wins over both.
 */
export function OutputStyleField() {
  const { settings, update } = useUserSettings()
  const current = settings.agentSettings?.outputStyle
  const [styles, setStyles] = useState<OutputStyleSummary[]>([])
  useEffect(() => {
    let live = true
    backendClient
      .listOutputStyles()
      .then((next) => live && setStyles(next))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])
  return (
    <SettingsSection
      anchor="prefs-output-style"
      scope="workspace"
      title="Output style"
      description="How agents respond in every chat: tone, length and format. A chat can pick its own with /output-style."
      actions={
        <Select
          size="xl"
          className="w-full @xl:w-64"
          contentClassName="w-80"
          value={current ?? DEFAULT_VALUE}
          onValueChange={(next) => {
            const { outputStyle: _previous, ...rest } =
              useUserSettings.getState().settings.agentSettings ?? {}
            update({
              agentSettings: next === DEFAULT_VALUE ? rest : { ...rest, outputStyle: next },
            })
          }}
          options={outputStyleOptions(styles, current)}
          aria-label="Default output style"
        />
      }
    />
  )
}
