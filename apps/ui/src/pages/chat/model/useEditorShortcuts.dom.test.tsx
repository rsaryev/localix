import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

/** A palette mounts the first time it opens and stays mounted after it closes. */
test('a palette shortcut opens and closes it, and the palette stays mounted once opened', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { CMD } = await import('@/shared/lib/keybindings')
  const { executeAction } = await import('@/shared/lib/actions/registry')
  const { useEditorShortcuts } = await import('./useEditorShortcuts')
  const noop = () => {}
  let state: ReturnType<typeof useEditorShortcuts> | null = null
  const seen: [boolean, boolean][] = []
  function Probe() {
    state = useEditorShortcuts({
      isMobile: false,
      toggleSidebar: noop,
      togglePanel: noop,
      toggleBottomPanel: noop,
      cycleTab: noop,
      focusGroup: noop,
      focusPart: noop,
      closeEditor: noop,
      reopenClosedTab: noop,
      newChat: noop,
    })
    seen.push([state.quickOpen, state.quickOpenMounted])
    return null
  }
  const root = createRoot(document.createElement('div'))
  const run = (commandId: string) => act(async () => void executeAction(commandId, {} as never))
  try {
    await act(async () => root.render(<Probe />))
    expect(state!.quickOpen).toBe(false)
    expect(state!.quickOpenMounted).toBe(false)

    await run(CMD.goToFile)
    expect(state!.quickOpen).toBe(true)
    expect(state!.quickOpenMounted).toBe(true)
    // Never a render where the palette is open but not mounted.
    expect(seen).not.toContainEqual([true, false])

    await run(CMD.goToFile)
    expect(state!.quickOpen).toBe(false)
    expect(state!.quickOpenMounted).toBe(true)
    expect(state!.commandPaletteMounted).toBe(false)

    await act(async () => state!.setCommandPalette(true))
    expect(state!.commandPalette).toBe(true)
    expect(state!.commandPaletteMounted).toBe(true)
    await act(async () => state!.setCommandPalette((open) => !open))
    expect(state!.commandPalette).toBe(false)
    expect(state!.commandPaletteMounted).toBe(true)
    expect(state!.globalSearchMounted).toBe(false)
  } finally {
    await act(async () => root.unmount())
  }
})
