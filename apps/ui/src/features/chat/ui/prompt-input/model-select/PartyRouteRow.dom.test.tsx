import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import type { CatalogModel } from '@localixai/agent/catalog'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const strong: CatalogModel = {
  id: 'openai/gpt-6.1-sol',
  name: 'GPT-6.1 Sol',
  providerId: 'openai',
  providerName: 'OpenAI',
  supportsTools: true,
  supportsReasoning: true,
  // No `off`, no `minimal`: a level outside this list must land on one inside it.
  reasoningEfforts: ['low', 'medium', 'high'],
  supportsAttachment: false,
  inputModalities: ['text'],
  outputModalities: ['text'],
}
const connections = [{ id: 'conn-openai', providerId: 'openai' }]

async function mountRoot() {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  return {
    act,
    host,
    render: (node: React.ReactNode) => act(async () => root.render(node)),
    unmount: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('All agents row', () => {
  test('sits first in the Agents group, names the mixed state, and selects the room', async () => {
    const { ModelTaskColumn } = await import('./ModelTaskColumn')
    const selected: string[] = []
    const ui = await mountRoot()
    try {
      await ui.render(
        <ModelTaskColumn
          activeTask="agent:localix"
          onSelectTask={(key) => selected.push(key)}
          modelLabelFor={() => null}
          enabledFor={() => true}
          onEnabledChange={() => {}}
          participants={[
            { agentId: 'localix', handle: 'localix' },
            { agentId: 'qa', handle: 'qa' },
          ]}
          party={{ status: 'Mixed · 2 models · 1 not set', mixed: true, chosen: false }}
        />,
      )
      const button = ui.host.querySelector<HTMLButtonElement>(
        'button[aria-label="Configure all agents"]',
      )!
      const buttons = [...ui.host.querySelectorAll('button')]
      expect(buttons.indexOf(button)).toBe(0)
      // The state is read with the control, not only seen.
      const status = document.getElementById(button.getAttribute('aria-describedby')!)
      expect(status?.textContent).toBe('Mixed · 2 models · 1 not set')
      await ui.act(async () => button.click())
      expect(selected).toEqual(['party'])
    } finally {
      await ui.unmount()
    }
  })

  test('is absent when the column is given no party row', async () => {
    const { ModelTaskColumn } = await import('./ModelTaskColumn')
    const ui = await mountRoot()
    try {
      await ui.render(
        <ModelTaskColumn
          activeTask="agent:a"
          onSelectTask={() => {}}
          modelLabelFor={() => null}
          enabledFor={() => true}
          onEnabledChange={() => {}}
          participants={[{ agentId: 'a', handle: 'a' }]}
        />,
      )
      expect(ui.host.querySelector('[data-testid="party-route-row"]')).toBeNull()
    } finally {
      await ui.unmount()
    }
  })

  test('picking a model for the room sends one choice with a level that model offers', async () => {
    const { useModelTaskRouting } = await import('./useModelTaskRouting')
    const picks = mock((_c: string, _m: string, _e: string) => {})
    const levels = mock((_e: string) => {})
    const ui = await mountRoot()
    function Harness({ shared }: { shared: boolean }) {
      const routing = useModelTaskRouting({
        models: [strong],
        connections: connections as never,
        orderedConnections: connections as never,
        taskKey: 'party',
        sessionModelId: '',
        sessionConnectionId: null,
        participantRoute: () => null,
        // Mixed room: no shared route. Shared: everyone already on `strong` at `max`.
        partyRoute: () =>
          shared
            ? { providerConnectionId: 'conn-openai', modelId: strong.id, reasoningEffort: 'max' }
            : null,
        onPickSessionModel: () => {
          throw new Error('a room pick must not re-route a single member')
        },
        onPickPartyModel: picks,
        onPartyReasoningChange: levels,
      })
      return (
        <>
          <button
            type="button"
            id="pick"
            aria-label="Pick for everyone"
            onClick={() => void routing.pickModel('conn-openai', strong.id)}
          />
          <button
            type="button"
            id="level"
            aria-label="Set level for everyone"
            onClick={() =>
              routing.changeModelReasoning(strong, 'high', routing.isCurrentModel(strong))
            }
          />
          <output>{routing.reasoningFor(strong, routing.isCurrentModel(strong))}</output>
        </>
      )
    }
    try {
      await ui.render(<Harness shared={false} />)
      await ui.act(async () => ui.host.querySelector<HTMLButtonElement>('#pick')!.click())
      // Nobody's previous level carries over: the model's default, which it offers.
      expect(picks.mock.calls).toEqual([['conn-openai', strong.id, 'medium']])

      await ui.render(<Harness shared />)
      // The room's stored `max` is shown as what the request carries for this model.
      expect(ui.host.querySelector('output')?.textContent).toBe('high')
      await ui.act(async () => ui.host.querySelector<HTMLButtonElement>('#level')!.click())
      expect(levels.mock.calls).toEqual([['high']])
    } finally {
      await ui.unmount()
    }
  })
})
