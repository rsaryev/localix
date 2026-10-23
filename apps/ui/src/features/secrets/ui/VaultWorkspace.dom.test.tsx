import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import type { SecretMeta } from '@localixai/api/client'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(async () => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

const item = (overrides: Partial<SecretMeta>): SecretMeta => ({
  id: 'secret-1',
  key: 'PERSONAL_TOKEN',
  label: 'Personal token',
  type: 'secret',
  source: 'user',
  backend: 'local',
  version: 1,
  tags: [],
  reference: 'secret:PERSONAL_TOKEN',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
})

const findButton = (container: HTMLElement, label: string) =>
  Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === label,
  )

describe('Vault workspace presentation', () => {
  test('uses flat registry rows across items, usage and activity', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { secretsApi } = await import('@/shared/api/secretsApi')
    const { VaultWorkspace } = await import('./VaultWorkspace')
    const items = [
      item({}),
      item({
        id: 'provider-1',
        key: 'OPENAI_API_KEY',
        label: 'OpenAI',
        source: 'provider',
        reference: null,
      }),
    ]
    const list = spyOn(secretsApi, 'list').mockResolvedValue(items)
    const bindings = spyOn(secretsApi, 'bindings').mockImplementation(async (key) =>
      key === 'PERSONAL_TOKEN'
        ? [
            {
              consumerType: 'plugin',
              consumerId: 'linear',
              field: 'token',
              label: 'Linear',
            },
          ]
        : [],
    )
    const activity = spyOn(secretsApi, 'activity').mockResolvedValue([
      {
        id: 1,
        itemId: 'secret-1',
        key: 'PERSONAL_TOKEN',
        label: 'Personal token',
        actorType: 'plugin',
        actorId: 'linear',
        operation: 'resolve',
        result: 'success',
        createdAt: 1,
      },
    ])

    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => {
      root.render(<VaultWorkspace />)
      await settle()
    })

    expect(container.textContent).toContain('2Items')
    expect(container.textContent).toContain('1Provider & plugin')
    expect(container.querySelector('[data-slot="workbench-toolbar"]')?.tagName).toBe('HEADER')
    expect(
      container
        .querySelector('[data-slot="workbench-toolbar-section"]')
        ?.getAttribute('aria-label'),
    ).toBe('Vault actions')
    const summary = container.querySelector<HTMLElement>('[data-slot="workbench-statusbar"]')
    expect(summary?.getAttribute('aria-label')).toBe('Vault summary')
    expect(summary?.querySelectorAll('[data-slot="workbench-status-item"]')).toHaveLength(4)
    expect(container.textContent).toContain('Personal token')
    expect(container.textContent).toContain('Generic secret·Personal·PERSONAL_TOKEN·v1')

    await act(async () => {
      findButton(container, 'Usage')?.click()
      await settle()
    })
    expect(container.textContent).toContain('Consumer map')
    expect(container.textContent).toContain('Linear')

    await act(async () => {
      findButton(container, 'Activity')?.click()
      await settle()
    })
    expect(container.textContent).toContain('Vault activity')
    expect(container.textContent).toContain('resolve')

    await act(async () => root.unmount())
    list.mockRestore()
    bindings.mockRestore()
    activity.mockRestore()
  })

  test('does not describe an unavailable Vault as empty and retries in place', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { secretsApi } = await import('@/shared/api/secretsApi')
    const { VaultWorkspace } = await import('./VaultWorkspace')
    let attempt = 0
    const list = spyOn(secretsApi, 'list').mockImplementation(async () => {
      attempt += 1
      if (attempt === 1) throw new Error('Encrypted store unavailable')
      return []
    })

    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => {
      root.render(<VaultWorkspace />)
      await settle()
    })

    expect(container.textContent).toContain('Encrypted store unavailable')
    expect(container.textContent).not.toContain('Your Vault is empty')

    await act(async () => {
      findButton(container, 'Retry')?.click()
      await settle()
    })
    expect(list).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('Your Vault is empty')
    expect(container.textContent).not.toContain('Encrypted store unavailable')

    await act(async () => root.unmount())
    list.mockRestore()
  })
})
