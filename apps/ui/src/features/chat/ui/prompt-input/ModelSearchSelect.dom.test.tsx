import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CatalogModel } from '@localixai/agent/catalog'
import type { ProviderConnection } from '@/shared/api/contracts'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

const models: CatalogModel[] = [
  {
    id: 'gpt-5.6',
    name: 'GPT-5.6 Sol',
    providerId: 'openai-codex',
    providerName: 'OpenAI Codex',
    supportsTools: true,
    supportsReasoning: true,
    supportsAttachment: true,
    inputModalities: ['text'],
    outputModalities: ['text'],
  },
]

const connection = (id: string, label: string): ProviderConnection => ({
  id,
  providerId: 'openai-codex',
  providerName: 'OpenAI Codex',
  label,
  authType: 'oauth-pkce',
  hasApiKey: false,
  keyCount: 0,
  keys: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

describe('ModelSearchSelect DOM runtime', () => {
  test('keeps the interaction-only drawer out of the startup import graph', () => {
    const source = readFileSync(resolve(import.meta.dir, './ModelSearchSelect.tsx'), 'utf8')

    expect(source).not.toContain("from '@/shared/ui/drawer'")
    expect(source).toContain("import('./ModelPickerDrawer')")
    expect(source).toContain("import('./model-select/ModelBrowser')")
    expect(source).toContain('const [drawer] = await Promise.all([')
    expect(source).toContain('const ModelPickerDrawer = lazy(')
  })

  test('refreshes its compact trigger from reconnect state at a narrow width', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { ModelSearchSelect } = await import('./ModelSearchSelect')
    const host = document.createElement('div')
    host.style.width = '280px'
    document.body.append(host)
    const root = createRoot(host)
    let changedEffort: string | null = null
    const render = async (activeConnection: ProviderConnection) => {
      const connectionsState = {
        connections: [activeConnection],
        activeConnection,
        activeId: activeConnection.id,
      }
      await act(async () =>
        root.render(
          <ModelSearchSelect
            models={models}
            value="gpt-5.6"
            onSelectionChange={() => {}}
            connectionsState={connectionsState as never}
            reasoningEffort="high"
            sessionId="session-1"
            focused
            onReasoningEffortChange={(effort) => {
              changedEffort = effort
            }}
          />,
        ),
      )
    }

    try {
      await render(connection('oauth-1', 'OpenAI Codex'))
      const trigger = host.querySelector('button[aria-haspopup="dialog"][aria-label^="Choose"]')!
      expect(trigger.getAttribute('role')).toBeNull()
      expect(trigger.textContent).toContain('GPT-5.6 Sol')
      expect(trigger.textContent).toContain('OpenAI Codex')
      expect(trigger.textContent).not.toContain('High')
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      const reasoningTrigger = host.querySelector(
        'button[aria-label="Reasoning for GPT-5.6 Sol: High"]',
      )
      expect(reasoningTrigger).not.toBeNull()
      expect(reasoningTrigger?.textContent).toContain('High')
      expect(trigger.contains(reasoningTrigger)).toBe(false)

      await act(async () => {
        ;(reasoningTrigger as HTMLButtonElement).focus()
        reasoningTrigger!.dispatchEvent(
          new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
        )
        await new Promise((resolve) => setTimeout(resolve, 30))
      })
      const menu = document.body.querySelector('[role="menu"]')
      expect(menu).not.toBeNull()
      // The model the level belongs to heads the menu, then one radio row per level.
      expect(menu?.textContent).toContain('GPT-5.6 Sol')
      const level = (label: string) =>
        [...menu!.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((row) =>
          row.textContent?.startsWith(label),
        )
      expect(level('High')?.getAttribute('aria-checked')).toBe('true')
      const maxOption = level('Max')
      expect(maxOption?.getAttribute('aria-checked')).toBe('false')
      await act(async () => {
        maxOption!.click()
        await new Promise((resolve) => setTimeout(resolve, 30))
      })
      expect(changedEffort as string | null).toBe('max')
      expect(reasoningTrigger?.getAttribute('aria-expanded')).toBe('false')

      await render(connection('oauth-2', 'Codex refreshed'))
      const refreshedTrigger = host.querySelector(
        'button[aria-haspopup="dialog"][aria-label^="Choose"]',
      ) as HTMLButtonElement
      expect(refreshedTrigger.textContent).toContain('Codex refreshed')
      expect(host.querySelector('.min-w-0')).not.toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
