import { useMemo } from 'react'
import { Select, type SelectOption } from '@localixai/kit/select'
import { CUSTOM_PRESET_ID, KEYMAP_PRESETS } from '@/shared/lib/keybindings'
import { useKeybindingsEditor } from '../model/useKeybindings'

/**
 * The base keymap choice, for Settings → Keyboard shortcuts and the setup tips' keymap slide: the
 * real presets, plus a read-only "Custom" entry surfaced only while the live overrides match no
 * preset (e.g. a hand-edit). Each says what it is under its name: a line beside the field
 * described only the CURRENT preset, so comparing two meant applying one — which rewrites the
 * whole keymap. Choosing the current preset, or Custom, changes nothing.
 */
export function useBaseKeymapChoice(): {
  activePreset: string
  options: SelectOption[]
  choose: (id: string) => void
} {
  const { activePreset, applyPreset } = useKeybindingsEditor()
  const options: SelectOption[] = useMemo(() => {
    const opts: SelectOption[] = KEYMAP_PRESETS.map((p) => ({
      value: p.id,
      label: p.label,
      description: p.description,
    }))
    if (activePreset === CUSTOM_PRESET_ID)
      opts.push({
        value: CUSTOM_PRESET_ID,
        label: 'Custom',
        description: 'Your bindings differ from every preset.',
      })
    return opts
  }, [activePreset])
  const choose = (id: string) => {
    if (id !== CUSTOM_PRESET_ID && id !== activePreset) applyPreset(id)
  }
  return { activePreset, options, choose }
}

/** The base keymap picker of Settings → Keyboard shortcuts. */
export function BaseKeymapSelect() {
  const { activePreset, options, choose } = useBaseKeymapChoice()
  return (
    <Select
      size="xl"
      aria-label="Base keymap"
      value={activePreset}
      onValueChange={choose}
      options={options}
      className="w-52 shrink-0 @max-xl:w-full"
      contentClassName="w-80"
    />
  )
}
