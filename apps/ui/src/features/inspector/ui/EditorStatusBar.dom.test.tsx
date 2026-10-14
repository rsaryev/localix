import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

async function mount(props: { language?: string; autoLanguage?: string }) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { EditorStatusBar } = await import('./EditorStatusBar')
  const converted: string[] = []
  const languages: Array<string | null> = []
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <EditorStatusBar
        cursor={null}
        text={'a\n  b\n'}
        language={props.language}
        autoLanguage={props.autoLanguage}
        onLanguageChange={(id) => languages.push(id)}
        onConvertIndentation={(next) => converted.push(next)}
      />,
    ),
  )
  const menuRows = () => [
    ...document.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]'),
  ]
  return {
    converted,
    languages,
    open: async (labelPrefix: string) => {
      const trigger = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
        button.getAttribute('aria-label')?.startsWith(labelPrefix),
      )!
      await act(async () => {
        trigger.focus()
        trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle()
      })
    },
    item: (label: string) => menuRows().find((element) => element.textContent?.startsWith(label)),
    menuOpen: () => document.querySelector('[role="menu"]') !== null,
    pick: async (element: HTMLElement | undefined) => {
      expect(element).toBeDefined()
      await act(async () => {
        element!.click()
        await settle()
      })
    },
    unmount: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('EditorStatusBar — indentation menu', () => {
  test('tab width is a titled radio choice that keeps the menu open', async () => {
    const ui = await mount({ language: 'typescript', autoLanguage: 'typescript' })
    try {
      await ui.open('Indentation')
      // A real group title, not a styled div among the rows.
      expect(document.querySelector('[role="menu"]')?.textContent).toContain('Tab width')
      expect(ui.item('2 spaces')?.getAttribute('role')).toBe('menuitemradio')
      expect(ui.item('2 spaces')?.getAttribute('aria-checked')).toBe('true')
      expect(ui.item('8 spaces')?.getAttribute('aria-checked')).toBe('false')

      await ui.pick(ui.item('8 spaces'))
      expect(ui.menuOpen()).toBe(true)
      expect(ui.item('8 spaces')?.getAttribute('aria-checked')).toBe('true')
      expect(ui.item('2 spaces')?.getAttribute('aria-checked')).toBe('false')

      // The convert actions are plain commands, and they use the width just picked.
      expect(ui.item('Convert Indentation to Tabs')?.getAttribute('role')).toBe('menuitem')
      await ui.pick(ui.item('Convert Indentation to Tabs'))
      // At the detected width (2) the two spaces would become a tab; at the picked 8 they stay.
      expect(ui.converted).toEqual(['a\n  b\n'])
    } finally {
      await ui.unmount()
    }
  })
})

describe('EditorStatusBar — language menu', () => {
  test('languages are radio rows, the applied one checked', async () => {
    const ui = await mount({ language: 'typescript', autoLanguage: 'typescript' })
    try {
      await ui.open('Language mode')
      expect(ui.item('TypeScript')?.getAttribute('role')).toBe('menuitemradio')
      expect(ui.item('TypeScript')?.getAttribute('aria-checked')).toBe('true')
      expect(ui.item('Python')?.getAttribute('aria-checked')).toBe('false')
      // Not overridden: nothing to reset to.
      expect(ui.item('Auto detect')).toBeUndefined()
      await ui.pick(ui.item('Python'))
      expect(ui.languages).toEqual(['python'])
    } finally {
      await ui.unmount()
    }
  })

  test('an override offers Auto detect with the detected language as its hint', async () => {
    const ui = await mount({ language: 'python', autoLanguage: 'typescript' })
    try {
      await ui.open('Language mode')
      const reset = ui.item('Auto detect')
      expect(reset?.getAttribute('role')).toBe('menuitem')
      // The detected value sits in the hint column, not folded into the label.
      expect(reset?.textContent).toBe('Auto detectTypeScript')
      expect(reset?.textContent).not.toContain('(')
      await ui.pick(reset)
      expect(ui.languages).toEqual([null])
    } finally {
      await ui.unmount()
    }
  })
})
