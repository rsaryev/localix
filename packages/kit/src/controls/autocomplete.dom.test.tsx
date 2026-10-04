import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '../testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await teardown()
})

describe('Autocomplete popup foundation', () => {
  test('portals the listbox while retaining input focus and active-descendant ownership', async () => {
    const React = await import('react')
    const { act, useId, useState } = React
    const { createRoot } = await import('react-dom/client')
    const { Input } = await import('./input')
    const { Autocomplete, AutocompleteAnchor, AutocompleteList, AutocompleteOption } =
      await import('./autocomplete')
    const listRef = React.createRef<HTMLDivElement>()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    function Harness() {
      const [open, setOpen] = useState(false)
      const id = useId()
      return (
        <Autocomplete open={open} onOpenChange={setOpen}>
          <AutocompleteAnchor asChild>
            <Input
              aria-label="Package"
              role="combobox"
              aria-autocomplete="list"
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-controls={open ? id : undefined}
              aria-activedescendant={open ? `${id}-active` : undefined}
              onFocus={() => setOpen(true)}
            />
          </AutocompleteAnchor>
          {open && (
            <AutocompleteList ref={listRef} id={id} aria-label="Package suggestions">
              <AutocompleteOption id={`${id}-active`} active onClick={() => setOpen(false)}>
                localix
              </AutocompleteOption>
              <AutocompleteOption active={false}>carbon</AutocompleteOption>
            </AutocompleteList>
          )}
        </Autocomplete>
      )
    }

    try {
      await act(async () => root.render(<Harness />))
      const input = host.querySelector<HTMLInputElement>('input')!
      await act(async () => input.focus())

      const list = document.body.querySelector<HTMLDivElement>(
        '[data-slot="autocomplete-list"][role="listbox"]',
      )!
      const active = list.querySelector<HTMLButtonElement>('[aria-selected="true"]')!

      expect(host.contains(list)).toBe(false)
      expect(listRef.current).toBe(list)
      expect(document.activeElement).toBe(input)
      expect(input.getAttribute('aria-controls')).toBe(list.id)
      expect(input.getAttribute('aria-activedescendant')).toBe(active.id)
      expect(list.classList).toContain('w-(--radix-popover-trigger-width)')

      const mouseDownAccepted = active.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
      )
      expect(mouseDownAccepted).toBe(false)
      expect(document.activeElement).toBe(input)

      await act(async () => active.click())
      expect(input.getAttribute('aria-expanded')).toBe('false')
      expect(input.getAttribute('aria-activedescendant')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('keeps rich panel chrome pinned around one scrolling options body', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { Input } = await import('./input')
    const { ResultCountStatus } = await import('@localixai/plugin-sdk/ui/result-count-status')
    const {
      Autocomplete,
      AutocompleteAnchor,
      AutocompleteBody,
      AutocompleteHeader,
      AutocompleteOption,
      AutocompleteOptions,
      AutocompletePanel,
    } = await import('./autocomplete')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () =>
        root.render(
          <Autocomplete open>
            <AutocompleteAnchor asChild>
              <Input aria-label="Resource" role="combobox" />
            </AutocompleteAnchor>
            <AutocompletePanel side="top">
              <AutocompleteHeader>
                <button type="button">All resources</button>
              </AutocompleteHeader>
              <ResultCountStatus count={1} />
              <AutocompleteBody>
                <AutocompleteOptions id="resources" aria-label="Resources">
                  <AutocompleteOption active>Database</AutocompleteOption>
                </AutocompleteOptions>
                <div data-testid="notice">Results truncated</div>
              </AutocompleteBody>
            </AutocompletePanel>
          </Autocomplete>,
        ),
      )

      const input = host.querySelector<HTMLInputElement>('input')!
      input.focus()
      const panel = document.body.querySelector<HTMLElement>('[data-slot="autocomplete-panel"]')!
      const header = panel.querySelector<HTMLElement>('[data-slot="autocomplete-header"]')!
      const body = panel.querySelector<HTMLElement>('[data-slot="autocomplete-body"]')!
      const list = panel.querySelector<HTMLElement>('[data-slot="autocomplete-options"]')!
      const status = panel.querySelector<HTMLElement>('[data-slot="result-count-status"]')!
      const headerButton = header.querySelector<HTMLButtonElement>('button')!

      expect(host.contains(panel)).toBe(false)
      expect(panel.dataset.layout).toBe('structured')
      expect(panel.classList).toContain('overflow-hidden')
      expect(panel.classList).not.toContain('overflow-y-auto')
      expect(body.classList).toContain('overflow-y-auto')
      expect(body.contains(list)).toBe(true)
      expect(body.querySelector('[data-testid="notice"]')).not.toBeNull()
      expect(header.contains(body)).toBe(false)
      expect(list.contains(status)).toBe(false)

      const mouseDownAccepted = headerButton.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
      )
      expect(mouseDownAccepted).toBe(false)
      expect(document.activeElement).toBe(input)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
