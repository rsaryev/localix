import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { KEYMAP_PRESETS, presetOverrides, CMD, useKeybindingsStore } from '@/shared/lib/keybindings'
import { useChordStore } from '@localixai/kit/keybindings'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

test('applying, editing and resetting a preset keep persisted identity and runtime bindings consistent', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useSettingsStore } = await import('./settingsStore')
  const { useKeybindingsEditor, useSyncKeybindings } = await import('./useKeybindings')
  const previous = useSettingsStore.getState()
  const previousBindings = useKeybindingsStore.getState()
  useSettingsStore.setState({
    synced: false,
    settings: {
      uiSettings: {
        fontFamily: 'system',
        keymapPreset: 'windsurf',
        keybindings: presetOverrides('windsurf', 'windows'),
      },
      agentSettings: {},
    },
  })
  function Harness() {
    useSyncKeybindings()
    const editor = useKeybindingsEditor()
    return (
      <>
        <output>{editor.activePreset}</output>
        {KEYMAP_PRESETS.map((preset) => (
          <button key={preset.id} onClick={() => editor.applyPreset(preset.id)}>
            {preset.id}
          </button>
        ))}
        <button onClick={() => editor.setBinding(CMD.goToFile, 'mod+9')}>Edit</button>
        <button onClick={editor.resetAll}>Reset</button>
      </>
    )
  }
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    await act(async () => root.render(<Harness />))
    expect(host.querySelector('output')?.textContent).toBe('windsurf')
    expect(useKeybindingsStore.getState().overrides).toEqual(presetOverrides('windsurf'))
    const button = (label: string) =>
      [...host.querySelectorAll('button')].find((candidate) => candidate.textContent === label)!
    for (const preset of KEYMAP_PRESETS) {
      await act(async () => button(preset.id).click())
      expect(host.querySelector('output')?.textContent).toBe(preset.id)
      expect(useSettingsStore.getState().settings.uiSettings.keymapPreset).toBe(preset.id)
      expect(useKeybindingsStore.getState().overrides).toEqual(presetOverrides(preset.id))
      expect(useSettingsStore.getState().settings.uiSettings.fontFamily).toBe('system')
    }
    await act(async () => button('Edit').click())
    expect(host.querySelector('output')?.textContent).toBe('custom')
    expect(useKeybindingsStore.getState().resolved[CMD.goToFile]).toBe('mod+9')
    await act(async () => button('Reset').click())
    expect(host.querySelector('output')?.textContent).toBe('default')
    expect(useSettingsStore.getState().settings.uiSettings.keymapPreset).toBe('default')
    expect(useKeybindingsStore.getState().resolved[CMD.goToFile]).toBe('mod+p')
  } finally {
    await act(async () => root.unmount())
    const timer = useSettingsStore.getState()._debounceTimer
    if (timer && timer !== previous._debounceTimer) clearTimeout(timer)
    useSettingsStore.setState(previous, true)
    useKeybindingsStore.setState(previousBindings, true)
    useChordStore.getState().setResolved(previousBindings.resolved)
  }
})
