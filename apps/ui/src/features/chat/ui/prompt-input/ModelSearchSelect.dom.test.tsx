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
  test('rotates participant model names and provider marks without showing agent names', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { ModelSearchSelect } = await import('./ModelSearchSelect')
    const originalInterval = globalThis.setInterval
    const ticks: (() => void)[] = []
    globalThis.setInterval = ((callback: () => void, delay: number) => {
      if (delay === 4000) {
        ticks.push(callback)
        return 0
      }
      return originalInterval(callback, delay)
    }) as typeof setInterval
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const first = connection('one', 'OpenAI')
    const second = { ...connection('two', 'Anthropic'), providerId: 'anthropic' }
    try {
      await React.act(async () =>
        root.render(
          <ModelSearchSelect
            models={[
              ...models,
              { ...models[0]!, id: 'claude', name: 'Claude', providerId: 'anthropic' },
            ]}
            value="gpt-5.6"
            connectionsState={
              { connections: [first, second], activeConnection: first, activeId: first.id } as never
            }
            participants={[
              {
                agentId: 'a',
                handle: 'first-agent',
                providerConnectionId: 'one',
                modelId: 'gpt-5.6',
                reasoningEffort: 'high',
              },
              {
                agentId: 'b',
                handle: 'second-agent',
                providerConnectionId: 'two',
                modelId: 'claude',
                reasoningEffort: 'low',
              },
            ]}
            onSelectionChange={() => {}}
            onReasoningEffortChange={() => {}}
            reasoningEffort="high"
            sessionId="group"
            focused
          />,
        ),
      )
      const trigger = host.querySelector('button')!
      expect(trigger.textContent).toContain('GPT-5.6 Sol')
      const firstMark = trigger.querySelector('svg')?.outerHTML
      expect(ticks).toHaveLength(1)
      await React.act(async () => ticks[0]!())
      expect(trigger.textContent).toBe('Claude')
      expect(trigger.querySelector('svg')?.outerHTML).not.toBe(firstMark)
      expect(host.textContent).not.toContain('second-agent')
      expect(host.querySelector('[aria-label^="Permission mode"]')).toBeNull()
      await React.act(async () => ticks[0]!())
      expect(trigger.textContent).toContain('GPT-5.6 Sol')
    } finally {
      globalThis.setInterval = originalInterval
      await React.act(async () => root.unmount())
      host.remove()
    }
  })

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
            onReasoningEffortChange={() => {}}
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
      expect(reasoningTrigger).toBeNull()
      expect(host.querySelector('button[aria-label^="Reasoning for"]')).toBeNull()

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
