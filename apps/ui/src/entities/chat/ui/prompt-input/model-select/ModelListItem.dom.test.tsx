import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { CatalogModel } from '@localixai/agent/catalog'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

const model: CatalogModel = {
  id: 'gpt-5.6',
  name: 'GPT-5.6 Sol',
  providerId: 'openai-codex',
  providerName: 'OpenAI Codex',
  supportsTools: true,
  supportsReasoning: true,
  supportsAttachment: true,
  inputModalities: ['text'],
  outputModalities: ['text'],
  contextLength: 272_000,
  cost: { input: 5, output: 30 },
}

async function mount(selected: boolean) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { Command, CommandGroup, CommandList } = await import('@localixai/kit/command')
  const { ModelListItem } = await import('./ModelListItem')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  let selections = 0
  let favorites = 0

  await act(async () =>
    root.render(
      <Command shouldFilter={false}>
        <CommandList>
          <CommandGroup>
            <ModelListItem
              model={model}
              selected={selected}
              onSelect={() => selections++}
              onMouseEnter={() => {}}
              onMouseLeave={() => {}}
              favorited
              onToggleFavorite={() => favorites++}
            />
          </CommandGroup>
        </CommandList>
      </Command>,
    ),
  )

  return {
    host,
    counts: () => ({ selections, favorites }),
    click: async (element: Element | null) => {
      expect(element).not.toBeNull()
      await act(async () => (element as HTMLElement).click())
    },
    unmount: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('ModelListItem DOM runtime', () => {
  test.each([false, true])('rows show only the model name (selected: %s)', async (selected) => {
    const ui = await mount(selected)
    try {
      const row = ui.host.querySelector('[data-slot="command-item"]')
      expect(row?.textContent).toContain('GPT-5.6 Sol')
      expect(row?.textContent).not.toContain('context')
      expect(row?.textContent).not.toContain('Reasoning')
      expect(row?.textContent).not.toContain('$')
      expect(row?.querySelector('[data-slot="model-row-actions"]')).toBeNull()
      // Nothing that floats: the level lives in the details panel, never on the row.
      expect(row?.querySelector('[data-slot="popover-trigger"]')).toBeNull()
      // The current model is marked, not only filled: a fill alone reads as the hover.
      expect(row?.querySelector('[data-slot="model-row-current"] svg') != null).toBe(selected)
      expect(row?.querySelector('[data-slot="model-row-name"]')?.className).not.toContain(
        'truncate',
      )
      await ui.click(row?.querySelector('[data-slot="model-favorite-toggle"]') ?? null)
      expect(ui.counts()).toEqual({ selections: 0, favorites: 1 })
    } finally {
      await ui.unmount()
    }
  })
})
