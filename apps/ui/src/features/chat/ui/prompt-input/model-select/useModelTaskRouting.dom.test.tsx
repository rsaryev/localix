import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { CatalogModel } from '@localixai/agent/catalog'
import { registerDom } from '@localixai/kit/testing/dom'
import { useUserSettings } from '@/features/settings/model/useUserSettings'

const updateSettings = mock((_patch: unknown) => {})
const initialState = useUserSettings.getState()
const settingsState = {
  settings: { ...initialState.settings, agentSettings: initialState.settings.agentSettings },
}
beforeEach(() => {
  settingsState.settings = { ...initialState.settings, agentSettings: {} }
  useUserSettings.setState({ ...initialState, ...settingsState, update: updateSettings }, true)
  updateSettings.mockClear()
})
afterEach(() => useUserSettings.setState(initialState, true))

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const model: CatalogModel = {
  id: 'openai/gpt-test',
  name: 'GPT Test',
  providerId: 'openai',
  providerName: 'OpenAI',
  supportsTools: true,
  supportsReasoning: false,
  supportsAttachment: false,
  inputModalities: ['text'],
  outputModalities: ['text'],
}
const connections = [{ id: 'conn-openai', providerId: 'openai' }]

describe('useModelTaskRouting direct picks', () => {
  test('changing a workload level writes its slot and remembers it for that model', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { useModelTaskRouting } = await import('./useModelTaskRouting')
    const reasoningModel = { ...model, supportsReasoning: true }
    settingsState.settings.agentSettings = {
      modelRouting: {
        titleGeneration: {
          providerConnectionId: 'conn-openai',
          modelId: model.id,
          reasoningEffort: 'high',
          enabled: true,
        },
      },
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    function Harness() {
      const routing = useModelTaskRouting({
        models: [reasoningModel],
        connections: connections as never,
        orderedConnections: connections as never,
        taskKey: 'titleGeneration',
        sessionModelId: model.id,
        sessionConnectionId: 'conn-openai',
        reasoningEffort: 'low',
        onPickSessionModel: () => {},
      })
      return (
        <button
          type="button"
          onClick={() => routing.changeModelReasoning(reasoningModel, 'minimal', true)}
        >
          {routing.reasoningFor(reasoningModel, true)}
        </button>
      )
    }
    try {
      await act(async () => root.render(<Harness />))
      // The workload's own level — never the conversation's `low`.
      expect(host.textContent).toBe('high')
      await act(async () => host.querySelector('button')!.click())
      expect(updateSettings.mock.calls.at(-1)?.[0]).toEqual({
        agentSettings: {
          modelRouting: {
            titleGeneration: {
              providerConnectionId: 'conn-openai',
              modelId: model.id,
              reasoningEffort: 'minimal',
              enabled: true,
            },
          },
        },
      })
    } finally {
      await act(async () => root.unmount())
      host.remove()
      settingsState.settings.agentSettings = {}
      updateSettings.mockClear()
    }
  })

  test('another model starts at its own remembered level, else its default', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { DEFAULT_REASONING_EFFORT } = await import('@localixai/agent')
    const { useModelTaskRouting } = await import('./useModelTaskRouting')
    const picked = mock(() => {})
    const running = { ...model, supportsReasoning: true }
    const remembered = { ...running, id: 'openai/remembered', name: 'Remembered' }
    const fresh = { ...running, id: 'openai/fresh', name: 'Fresh' }
    settingsState.settings.agentSettings = {
      modelRouting: {
        session: {
          reasoningPreferences: [
            { providerId: 'openai', modelId: remembered.id, effort: 'minimal' },
          ],
        },
      },
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    function Harness() {
      const routing = useModelTaskRouting({
        models: [running, remembered, fresh],
        connections: connections as never,
        orderedConnections: connections as never,
        taskKey: 'session',
        sessionModelId: running.id,
        sessionConnectionId: 'conn-openai',
        reasoningEffort: 'max',
        onPickSessionModel: picked,
      })
      return (
        <>
          <button
            type="button"
            onClick={() => void routing.pickModel('conn-openai', remembered.id)}
          >
            remembered
          </button>
          <button type="button" onClick={() => void routing.pickModel('conn-openai', fresh.id)}>
            fresh
          </button>
        </>
      )
    }
    try {
      await act(async () => root.render(<Harness />))
      const [first, second] = host.querySelectorAll('button')
      await act(async () => first!.click())
      await act(async () => second!.click())
      // The running model's `max` carries to neither.
      expect(picked.mock.calls).toEqual([
        ['conn-openai', remembered.id, 'minimal', undefined],
        ['conn-openai', fresh.id, DEFAULT_REASONING_EFFORT, undefined],
      ] as never)
    } finally {
      await act(async () => root.unmount())
      host.remove()
      settingsState.settings.agentSettings = {}
    }
  })

  test.each([
    ['medium', 'high'],
    ['max', 'high'],
  ] as const)(
    'reselecting the active model preserves and clamps session %s',
    async (effort, expected) => {
      const { act } = await import('react')
      const { createRoot } = await import('react-dom/client')
      const { useModelTaskRouting } = await import('./useModelTaskRouting')
      const picked = mock(() => {})
      const host = document.createElement('div')
      document.body.append(host)
      const root = createRoot(host)
      const reasoningModel = {
        ...model,
        supportsReasoning: true,
        reasoningEfforts: ['low', 'high'],
      }
      settingsState.settings.agentSettings = {
        modelRouting: {
          session: {
            reasoningPreferences: [
              { providerId: model.providerId, modelId: model.id, effort: 'low' },
            ],
          },
        },
      }
      function Harness() {
        const routing = useModelTaskRouting({
          models: [reasoningModel],
          connections: connections as never,
          orderedConnections: connections as never,
          taskKey: 'agent:builtin:reviewer',
          sessionModelId: model.id,
          sessionConnectionId: 'conn-openai',
          participantRoute: () => ({
            providerConnectionId: 'conn-openai',
            modelId: model.id,
            reasoningEffort: effort,
          }),
          reasoningEffort: 'low',
          onPickSessionModel: picked,
        })
        return (
          <button type="button" onClick={() => void routing.pickModel('conn-openai', model.id)}>
            Pick
          </button>
        )
      }
      try {
        await act(async () => root.render(<Harness />))
        await act(async () => host.querySelector('button')!.click())
        expect(picked).toHaveBeenCalledWith('conn-openai', model.id, expected, 'builtin:reviewer')
      } finally {
        await act(async () => root.unmount())
        host.remove()
        settingsState.settings.agentSettings = {}
      }
    },
  )

  test.each([
    ['session', undefined],
    ['agent:builtin:reviewer', 'builtin:reviewer'],
  ] as const)('routes a %s pick through the session callback', async (taskKey, agentId) => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { useModelTaskRouting } = await import('./useModelTaskRouting')
    const picked = mock(() => {})
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    function Harness() {
      const routing = useModelTaskRouting({
        models: [model],
        connections: connections as never,
        orderedConnections: connections as never,
        taskKey,
        sessionModelId: model.id,
        sessionConnectionId: 'conn-openai',
        reasoningEffort: 'medium',
        onPickSessionModel: picked,
      })
      return (
        <button type="button" onClick={() => void routing.pickModel('conn-openai', model.id)}>
          {routing.modelLabelFor(taskKey)}
        </button>
      )
    }

    try {
      await act(async () => root.render(<Harness />))
      expect(host.textContent).toContain('GPT Test')
      await act(async () => host.querySelector('button')!.click())

      expect(picked).toHaveBeenCalledTimes(1)
      expect(picked).toHaveBeenCalledWith('conn-openai', model.id, 'off', agentId)
      expect(updateSettings).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      host.remove()
      updateSettings.mockClear()
    }
  })

  test('routes a workload pick to settings without invoking the conversation callback', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { useModelTaskRouting } = await import('./useModelTaskRouting')
    const picked = mock(() => {})
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    function Harness() {
      const routing = useModelTaskRouting({
        models: [model],
        connections: connections as never,
        orderedConnections: connections as never,
        taskKey: 'titleGeneration',
        sessionModelId: '',
        sessionConnectionId: null,
        reasoningEffort: 'medium',
        onPickSessionModel: picked,
      })
      return (
        <button type="button" onClick={() => void routing.pickModel('conn-openai', model.id)}>
          Pick
        </button>
      )
    }

    try {
      await act(async () => root.render(<Harness />))
      await act(async () => host.querySelector('button')!.click())

      expect(picked).not.toHaveBeenCalled()
      expect(updateSettings).toHaveBeenCalled()
      expect(updateSettings.mock.calls.at(-1)?.[0]).toMatchObject({
        agentSettings: {
          modelRouting: {
            titleGeneration: {
              providerConnectionId: 'conn-openai',
              modelId: model.id,
              reasoningEffort: 'off',
            },
          },
        },
      })
    } finally {
      await act(async () => root.unmount())
      host.remove()
      updateSettings.mockClear()
    }
  })
})
