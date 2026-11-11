import { useMemo } from 'react'
import { Select, type SelectOption } from '@localixai/kit/select'
import { CUSTOM_PRESET_ID, KEYMAP_PRESETS } from '@/shared/lib/keybindings'
import { useKeybindingsEditor } from '../model/useKeybindings'

/**
 * The base keymap picker, for Settings → Keyboard shortcuts and setup's Preferences step: the real
 * presets, plus a read-only "Custom" entry surfaced only while the live overrides match no preset
 * (e.g. a hand-edit). Each says what it is under its name: a line beside the field described only
 * the CURRENT preset, so comparing two meant applying one — which rewrites the whole keymap.
 */
export function BaseKeymapSelect() {
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
  return (
    <Select
      size="xl"
      aria-label="Base keymap"
      value={activePreset}
      onValueChange={(id) => {
        if (id !== CUSTOM_PRESET_ID && id !== activePreset) applyPreset(id)
      }}
      options={options}
      className="w-52 shrink-0 @max-xl:w-full"
      contentClassName="w-80"
    />
  )
}
