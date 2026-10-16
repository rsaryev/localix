import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
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

describe('ModelTaskColumn switch interaction', () => {
  test('selects a participant by stable agent ID while displaying its handle', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { ModelTaskColumn } = await import('./ModelTaskColumn')
    const onSelectTask = mock((_key: string) => {})
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () =>
        root.render(
          <ModelTaskColumn
            activeTask="agent:builtin:localix"
            onSelectTask={onSelectTask}
            modelLabelFor={() => null}
            enabledFor={() => true}
            onEnabledChange={() => {}}
            participants={[{ agentId: 'builtin:localix', handle: 'localix', label: 'Localix' }]}
          />,
        ),
      )
      await act(async () =>
        host.querySelector<HTMLButtonElement>('[aria-label="Configure Localix"]')!.click(),
      )
      expect(onSelectTask).toHaveBeenCalledWith('agent:builtin:localix')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('selects the workload and commits the native checked value exactly once', async () => {
    const React = await import('react')
    const { act, useState } = React
    const { createRoot } = await import('react-dom/client')
    const { ModelTaskColumn } = await import('./ModelTaskColumn')
    const onSelectTask = mock((_key: string) => {})
    const onEnabledChange = mock((_key: string, _enabled: boolean) => {})
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    function Harness() {
      const [titleGenerationEnabled, setTitleGenerationEnabled] = useState(true)
      return (
        <ModelTaskColumn
          activeTask="session"
          onSelectTask={onSelectTask}
          modelLabelFor={() => null}
          enabledFor={(key) => key !== 'titleGeneration' || titleGenerationEnabled}
          onEnabledChange={(key, enabled) => {
            onEnabledChange(key, enabled)
            if (key === 'titleGeneration') setTitleGenerationEnabled(enabled)
          }}
          participants={[]}
        />
      )
    }

    try {
      await act(async () => root.render(<Harness />))
      const input = host.querySelector<HTMLInputElement>(
        '[role="switch"][aria-label="Disable Session titles"]',
      )!

      await act(async () => input.click())

      expect(onSelectTask).toHaveBeenCalledTimes(1)
      expect(onSelectTask).toHaveBeenCalledWith('titleGeneration')
      expect(onEnabledChange).toHaveBeenCalledTimes(1)
      expect(onEnabledChange).toHaveBeenCalledWith('titleGeneration', false)
      expect(input.checked).toBe(false)
      expect(input.getAttribute('aria-checked')).toBe('false')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
