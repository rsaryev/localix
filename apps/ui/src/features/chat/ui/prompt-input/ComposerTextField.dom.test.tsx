import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ComponentProps } from 'react'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

test('shared drafts open one completion menu at the focused composer and close on blur', async () => {
  const { act, useState } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ComposerTextField } = await import('./ComposerTextField')
  const { useComposerCommands } = await import('./useComposerCommands')
  type Props = ComponentProps<typeof ComposerTextField>
  function Composer({ id, surfaceActive = true }: { id: string; surfaceActive?: boolean }) {
    const [focused, setFocused] = useState(false)
    const composer = useComposerCommands('/agents ', () => {})
    return (
      <ComposerTextField
        composer={composer}
        focused={focused}
        surfaceActive={surfaceActive}
        atRef={{ isOpen: false, suggestions: [], activeIndex: 0 } as unknown as Props['atRef']}
        openResource={{ rows: [], activeIndex: 0 } as unknown as Props['openResource']}
        openCommandActive={false}
        completionMenuId={id}
        suggestionGhost={undefined}
        placeholder="Message"
        disabled={false}
        highlight={undefined}
        onPaste={() => {}}
        onFocusChange={setFocused}
        onSubmit={() => {}}
        onKeyDown={composer.handleKeyDown}
        onCaretChange={() => {}}
      />
    )
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const menus = () => document.body.querySelectorAll('[role="listbox"]')
  try {
    await act(async () =>
      root.render(
        <>
          <Composer id="main" />
          <Composer id="second" />
          <Composer id="collapsed" surfaceActive={false} />
        </>,
      ),
    )
    const fields = host.querySelectorAll('textarea')
    expect(menus()).toHaveLength(0)
    await act(async () => fields[0]!.focus())
    expect(menus()).toHaveLength(1)
    expect(menus()[0]!.id).toBe('main')
    expect(fields[0]!.getAttribute('aria-controls')).toBe('main')
    expect(fields[1]!.getAttribute('aria-activedescendant')).toBeNull()
    await act(async () => fields[1]!.focus())
    expect(menus()).toHaveLength(1)
    expect(menus()[0]!.id).toBe('second')
    expect(fields[0]!.getAttribute('aria-activedescendant')).toBeNull()
    await act(async () => window.dispatchEvent(new Event('blur')))
    expect(document.activeElement).toBe(fields[1]!)
    expect(menus()).toHaveLength(0)
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(menus()).toHaveLength(1)
    expect(menus()[0]!.id).toBe('second')
    await act(async () => fields[1]!.blur())
    expect(menus()).toHaveLength(0)
    // A collapsed surface keeps its textarea focused while hidden.
    await act(async () => fields[2]!.focus())
    expect(menus()).toHaveLength(0)
    expect(fields[2]!.getAttribute('aria-expanded')).not.toBe('true')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
