import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { registerDom } from '../testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('Select DOM runtime', () => {
  test('exposes a labelled, portalled listbox and commits a selection', async () => {
    const React = await import('react')
    const { act, useState } = React
    const { createRoot } = await import('react-dom/client')
    const { Select } = await import('./select')
    const onValueChange = mock((_value: string) => {})
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    function Harness() {
      const [value, setValue] = useState('session')
      return (
        <>
          <span id="scope-label">Mode</span>
          <Select
            aria-labelledby="scope-label"
            size="xl"
            value={value}
            onValueChange={(next) => {
              onValueChange(next)
              setValue(next)
            }}
            options={[
              { value: 'session', label: 'From session' },
              { value: 'edit', label: 'Edit' },
              { value: 'locked', label: 'Locked', disabled: true },
            ]}
          />
        </>
      )
    }

    try {
      await act(async () => root.render(<Harness />))
      const trigger = host.querySelector<HTMLButtonElement>(
        'button[aria-labelledby="scope-label"]',
      )!
      expect(trigger).not.toBeNull()
      expect(trigger.textContent).toContain('From session')
      expect(trigger.className).toContain('h-[var(--chrome-control-xl)]')
      expect(trigger.getAttribute('role')).toBe('combobox')
      expect(trigger.getAttribute('aria-haspopup')).toBe('listbox')
      expect(trigger.getAttribute('aria-autocomplete')).toBe('none')
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      expect(host.querySelector('select')).toBeNull()

      await act(async () => {
        trigger.focus()
        trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }))
        await settle()
      })

      expect(onValueChange).toHaveBeenCalledWith('edit')
      expect(trigger.textContent).toContain('Edit')

      await act(async () => {
        trigger.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            button: 0,
            pointerType: 'mouse',
          }),
        )
        await settle()
      })

      const listbox = document.body.querySelector<HTMLElement>('[role="listbox"]')
      const items = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'))
      expect(listbox).not.toBeNull()
      if (!listbox) throw new Error('Select listbox did not open')
      expect(trigger.getAttribute('aria-controls')).toBe(listbox.id)
      expect(listbox.getAttribute('aria-labelledby')).toBe(trigger.id)
      expect(items).toHaveLength(3)
      expect(items[1]?.getAttribute('aria-selected')).toBe('true')
      expect(items[2]?.getAttribute('aria-disabled')).toBe('true')
      expect(host.contains(items[0] ?? null)).toBe(false)

      await act(async () => {
        items[0]?.click()
        await settle()
      })

      expect(onValueChange).toHaveBeenCalledWith('session')
      expect(trigger.textContent).toContain('From session')
      expect(document.body.querySelector('[role="listbox"]')).toBeNull()
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('draws an option as a menu row: description under the label, check at the end', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { Select } = await import('./select')
    const { MENU_TRAILING_INDICATOR } = await import('../overlays/popover-surface')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () =>
        root.render(
          <Select
            aria-label="Level"
            value="high"
            onValueChange={() => {}}
            options={[
              { value: 'low', label: 'Low', description: 'Answers fast, thinks little' },
              { value: 'high', label: 'High' },
            ]}
          />,
        ),
      )
      const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Level"]')!
      await act(async () => {
        trigger.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
        )
        await settle()
      })

      const [low, high] = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'))
      expect(low?.textContent).toContain('Answers fast, thinks little')
      // The trailing slot is on every row (so the edge aligns), the check only on the chosen one.
      const trailing = (row: HTMLElement | undefined) =>
        row?.querySelector(`span[class="${MENU_TRAILING_INDICATOR}"]`)
      expect(trailing(low)).not.toBeNull()
      expect(trailing(low)?.querySelector('svg')).toBeNull()
      expect(trailing(high)?.querySelector('svg')).not.toBeNull()
      // No hand-placed check geometry of its own any more.
      expect(high?.querySelector('.absolute')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('keeps a disabled trigger out of the interaction path', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { Select } = await import('./select')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () =>
        root.render(
          <Select
            aria-label="Disabled scope"
            disabled
            value="session"
            onValueChange={() => {}}
            options={[{ value: 'session', label: 'From session' }]}
          />,
        ),
      )
      const trigger = host.querySelector('button')!
      expect(trigger.disabled).toBe(true)
      trigger.click()
      expect(document.body.querySelector('[role="listbox"]')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('preserves an empty string as a real domain value', async () => {
    const React = await import('react')
    const { act, useState } = React
    const { createRoot } = await import('react-dom/client')
    const { Select } = await import('./select')
    const onValueChange = mock((_value: string) => {})
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    function Harness() {
      const [value, setValue] = useState('session')
      return (
        <Select
          aria-label="Scope"
          value={value}
          onValueChange={(next) => {
            onValueChange(next)
            setValue(next)
          }}
          options={[
            { value: '', label: 'All sessions' },
            { value: 'session', label: 'Current session' },
          ]}
        />
      )
    }

    try {
      await act(async () => root.render(<Harness />))
      const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Scope"]')!

      await act(async () => {
        trigger.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            button: 0,
            pointerType: 'mouse',
          }),
        )
        await settle()
      })

      const allSessions = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (option) => option.textContent?.includes('All sessions'),
      )
      await act(async () => {
        allSessions?.click()
        await settle()
      })

      expect(onValueChange).toHaveBeenCalledWith('')
      expect(trigger.textContent).toContain('All sessions')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
