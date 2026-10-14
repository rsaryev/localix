import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

describe('composer completion DOM runtime', () => {
  test('updates resource selection without stealing composer focus', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { CompletionMenu, completionOptionId } = await import('./CompletionMenu')
    const { TextArea } = await import('./TextArea')
    const { Autocomplete, AutocompleteAnchor } = await import('@localixai/kit/autocomplete')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const menuId = 'resource-runtime-menu'
    const render = async (activeIndex: number) => {
      await act(async () =>
        root.render(
          <Autocomplete open>
            <AutocompleteAnchor asChild>
              <div>
                <TextArea
                  value="@resource docker"
                  onChange={() => {}}
                  onFocus={() => {}}
                  onBlur={() => {}}
                  onSubmit={() => {}}
                  placeholder="Message"
                  disabled={false}
                  completion={{
                    open: true,
                    menuId,
                    activeOptionId: completionOptionId(menuId, activeIndex),
                  }}
                />
              </div>
            </AutocompleteAnchor>
            <CompletionMenu
              id={menuId}
              activeIndex={activeIndex}
              onHover={() => {}}
              top={<button type="button">All resources</button>}
              bottom={<div data-testid="listing-notice">Results truncated</div>}
              items={[
                {
                  key: 'docker',
                  index: 0,
                  sectionHeaders: [{ label: 'Resources' }],
                  content: 'Docker',
                  onSelect: () => {},
                },
                { key: 'databases', index: 1, content: 'Databases', onSelect: () => {} },
              ]}
            />
          </Autocomplete>,
        ),
      )
    }

    try {
      await render(0)
      const textarea = host.querySelector('textarea')!
      textarea.focus()
      expect(document.activeElement).toBe(textarea)
      await render(1)
      expect(document.activeElement).toBe(textarea)
      expect(textarea.getAttribute('aria-activedescendant')).toBe(completionOptionId(menuId, 1))
      const panel = document.body.querySelector<HTMLElement>('[data-slot="autocomplete-panel"]')!
      const list = panel.querySelector<HTMLElement>('[role="listbox"]')!
      const status = panel.querySelector<HTMLElement>('[data-slot="result-count-status"]')!
      const header = panel.querySelector<HTMLElement>('[data-slot="autocomplete-header"]')!
      const body = panel.querySelector<HTMLElement>('[data-slot="autocomplete-body"]')!
      expect(panel.querySelector('[aria-selected="true"]')?.textContent).toContain('Databases')
      expect(host.contains(panel)).toBe(false)
      expect(list.getAttribute('aria-label')).toBe('Composer suggestions')
      expect(list.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Resources')
      expect(list.querySelectorAll('[role="option"]')).toHaveLength(2)
      expect(header.contains(body)).toBe(false)
      expect(body.querySelector('[data-testid="listing-notice"]')).not.toBeNull()
      expect(status.textContent?.trim()).toBe('2 suggestions')
      expect(list.contains(status)).toBe(false)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('routes slash arguments through the shared virtual-focus listbox', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { SlashArgMenu } = await import('./SlashArgMenu')
    const { Autocomplete, AutocompleteAnchor } = await import('@localixai/kit/autocomplete')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    let selected = ''

    try {
      await act(async () =>
        root.render(
          <Autocomplete open>
            <AutocompleteAnchor asChild>
              <input aria-label="Command argument" />
            </AutocompleteAnchor>
            <SlashArgMenu
              menuId="slash-argument-menu"
              options={[
                { value: 'fast', label: 'Fast', description: 'Prefer latency' },
                { value: 'thorough', label: 'Thorough', description: 'Prefer depth' },
              ]}
              activeIndex={1}
              onSelect={(option) => {
                selected = option.value
              }}
              onHover={() => {}}
            />
          </Autocomplete>,
        ),
      )

      const input = host.querySelector<HTMLInputElement>('input')!
      input.focus()
      const list = document.body.querySelector<HTMLElement>(
        '[role="listbox"][aria-label="Command arguments"]',
      )!
      const options = list.querySelectorAll<HTMLButtonElement>('[data-slot="autocomplete-option"]')
      const active = list.querySelector<HTMLButtonElement>('[aria-selected="true"]')!
      const panel = list.closest<HTMLElement>('[data-slot="autocomplete-panel"]')!

      expect(options).toHaveLength(2)
      expect(active.textContent).toContain('Thorough')
      expect(panel.querySelector('[data-slot="result-count-status"]')?.textContent?.trim()).toBe(
        '2 options',
      )
      expect(document.activeElement).toBe(input)

      await act(async () => active.click())
      expect(selected).toBe('thorough')
      expect(document.activeElement).toBe(input)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('keeps the controlled empty listbox mounted and its message outside option ownership', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { CompletionMenu } = await import('./CompletionMenu')
    const { Autocomplete, AutocompleteAnchor } = await import('@localixai/kit/autocomplete')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () =>
        root.render(
          <Autocomplete open>
            <AutocompleteAnchor asChild>
              <input aria-label="Reference" aria-controls="empty-completion-menu" />
            </AutocompleteAnchor>
            <CompletionMenu
              id="empty-completion-menu"
              items={[]}
              activeIndex={0}
              onHover={() => {}}
              empty={<p data-testid="empty-completion">No matching references</p>}
            />
          </Autocomplete>,
        ),
      )

      const list = document.body.querySelector<HTMLElement>('#empty-completion-menu')!
      const body = list.closest<HTMLElement>('[data-slot="autocomplete-body"]')!
      const empty = body.querySelector<HTMLElement>('[data-testid="empty-completion"]')!

      expect(list.getAttribute('role')).toBe('listbox')
      expect(list.querySelectorAll('[role="option"]')).toHaveLength(0)
      expect(list.contains(empty)).toBe(false)
      expect(body.contains(empty)).toBe(true)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
