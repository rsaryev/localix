import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import type { CatalogModel } from '@localixai/agent/catalog'
import { registerDom } from '@localixai/kit/testing/dom'
import type {
  JoinRoutesView,
  SessionAgentRoute,
  SessionModelChoicesView,
} from '@/shared/api/contracts'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const model: CatalogModel = {
  id: 'openai/gpt-6.1-sol',
  name: 'GPT-6.1 Sol',
  providerId: 'openai',
  providerName: 'OpenAI',
  supportsTools: true,
  supportsReasoning: true,
  reasoningEfforts: ['low', 'medium', 'high'],
  supportsAttachment: false,
  inputModalities: ['text'],
  outputModalities: ['text'],
}
const connections = [{ id: 'conn-openai', providerId: 'openai' }]
const route = {
  providerConnectionId: 'conn-openai',
  modelId: model.id,
  reasoningEffort: 'high' as const,
}

const directoryAgent = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    record: { id, handle: id, label: id.toUpperCase(), ...extra },
    enabled: true,
    invocations: { chat: 'allow' },
  }) as never

/** The registry: one more agent that could join, and a disabled one. */
const directory = [
  directoryAgent('localix'),
  directoryAgent('qa'),
  { ...(directoryAgent('off') as object), enabled: false } as never,
]

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

describe('the picker lists every agent and always offers All', () => {
  test('All with one agent; uninvited agents listed; All then an invitation keeps the model', async () => {
    const { ModelTaskColumn } = await import('./ModelTaskColumn')
    const { participantRows } = await import('./participantRows')
    const { usePartyRoute } = await import('./usePartyRoute')
    const { agentTarget } = await import('./pickerTarget')
    const apply = mock((_choice: unknown, _agentIds: readonly string[]) => {})
    let pickAll: (() => void) | undefined

    function Picker({
      seated,
      choices,
      joinRoutes = null,
    }: {
      seated: SessionAgentRoute[]
      choices: SessionModelChoicesView
      joinRoutes?: JoinRoutesView | null
    }) {
      const rows = participantRows(
        seated,
        (id) =>
          (directory as { record: { id: string; label: string } }[]).find((a) => a.record.id === id)
            ?.record,
        { agents: directory, choices, joinRoutes },
      )
      const party = usePartyRoute({
        participants: rows,
        sessionConnectionId: null,
        models: [model],
        connections,
        onApplyPartyRoute: apply,
      })
      pickAll = () => void party.onPickPartyModel('conn-openai', model.id, 'high')
      return (
        <ModelTaskColumn
          activeTask={agentTarget('localix')}
          onSelectTask={() => {}}
          modelLabelFor={(key) => {
            const row = rows.find((candidate) => agentTarget(candidate.agentId) === key)
            return row?.route?.modelId ? model.name : null
          }}
          enabledFor={() => true}
          onEnabledChange={() => {}}
          participants={rows}
          {...(party.column ? { party: party.column } : {})}
        />
      )
    }

    const seat = (agentId: string, over: Partial<SessionAgentRoute> = {}): SessionAgentRoute => ({
      agentId,
      handle: agentId,
      providerConnectionId: null,
      modelId: 'other/model',
      reasoningEffort: 'medium',
      ...over,
    })
    const rowText = (host: HTMLElement, label: string) =>
      host.querySelector(`button[aria-label="Configure ${label}"]`)?.parentElement?.textContent

    const ui = await mountRoot()
    try {
      // One agent in the conversation: "All" is still offered, and not chosen.
      await ui.render(<Picker seated={[seat('localix')]} choices={{ agents: {} }} />)
      expect(ui.host.querySelector('[data-testid="party-route-row"]')).not.toBeNull()
      expect(ui.host.querySelector('[data-testid="party-route-chosen"]')).toBeNull()
      // The agent that could join is listed, marked as not invited; a disabled one is not.
      expect(rowText(ui.host, 'QA')).toContain('not invited')
      expect(ui.host.querySelector('button[aria-label="Configure HUMAN"]')).toBeNull()
      expect(ui.host.querySelector('button[aria-label="Configure OFF"]')).toBeNull()

      // "All" names every listed agent, the uninvited one included.
      await ui.act(async () => pickAll!())
      expect(apply.mock.calls).toEqual([
        [
          { providerConnectionId: 'conn-openai', modelId: model.id, reasoningEffort: 'high' },
          ['localix', 'qa'],
        ],
      ])

      // What the server answers: the seat moved, and every listed agent holds the choice.
      const chosen = { agents: { localix: route, qa: route } }
      await ui.render(<Picker seated={[seat('localix', route)]} choices={chosen} />)
      expect(ui.host.querySelector('[data-testid="party-route-chosen"]')).not.toBeNull()
      expect(rowText(ui.host, 'QA')).toContain(`${model.name} · not invited`)

      // QA is invited: it joined on its choice, and everyone still agrees.
      await ui.render(
        <Picker seated={[seat('localix', route), seat('qa', route)]} choices={chosen} />,
      )
      expect(rowText(ui.host, 'QA')).not.toContain('not invited')
      expect(ui.host.querySelector('[data-testid="party-route-chosen"]')).not.toBeNull()

      // A pick for one agent alone: the other keeps its model, and All is no longer chosen.
      await ui.render(
        <Picker
          seated={[seat('localix', route), seat('qa', { ...route, modelId: 'other/model' })]}
          choices={{
            ...chosen,
            agents: { ...chosen.agents, qa: { ...route, modelId: 'other/model' } },
          }}
        />,
      )
      expect(ui.host.querySelector('[data-testid="party-route-chosen"]')).toBeNull()

      // A new chat: no choices yet. QA shows what it would join on (its last pick, from the
      // server's chain); agreeing with the seat, "All" reads as chosen.
      await ui.render(
        <Picker
          seated={[seat('localix', route)]}
          choices={{ agents: {} }}
          joinRoutes={{ agents: { qa: route }, fallback: null }}
        />,
      )
      expect(rowText(ui.host, 'QA')).toContain(`${model.name} · not invited`)
      expect(ui.host.querySelector('[data-testid="party-route-chosen"]')).not.toBeNull()
    } finally {
      await ui.unmount()
    }
  })
})
