import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

// The slide's pick is Settings → Shortcuts → Base keymap in a sentence: the same presets, the
// same read-only "Custom" while hand-edited bindings match none, and a pick rewrites the keymap.
test('the keymap pick names a hand-edited keymap Custom and applies the preset chosen', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useSettingsStore } = await import('@/shared/lib/user-settings/settingsStore')
  const { CMD } = await import('@/shared/lib/keybindings')
  const { KeymapAction } = await import('./KeymapScene')
  const patches: unknown[] = []
  const saved = useSettingsStore.getState()
  useSettingsStore.setState({
    settings: { ...saved.settings, uiSettings: { keybindings: { [CMD.goToFile]: 'mod+alt+9' } } },
    update: (patch) => patches.push(patch),
  })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const item = (name: string) =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]')].find(
      (row) => row.textContent?.trim().startsWith(name),
    )
  try {
    await act(async () => root.render(<KeymapAction />))
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label^="Base keymap: "]')!
    expect(trigger.getAttribute('aria-label')).toBe('Base keymap: Custom. Change')
    await act(async () => {
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(item('Custom')?.getAttribute('aria-disabled')).toBe('true')
    await act(async () => item('JetBrains')!.click())
    expect(patches).toEqual([
      { uiSettings: expect.objectContaining({ keymapPreset: 'jetbrains' }) },
    ])
  } finally {
    await act(async () => root.unmount())
    host.remove()
    useSettingsStore.setState(saved)
  }
})
