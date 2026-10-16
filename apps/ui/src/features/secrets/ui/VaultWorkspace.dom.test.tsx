import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { readFileSync } from 'node:fs'
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
const source = [
  'VaultWorkspace.tsx',
  'VaultItemsView.tsx',
  'VaultItemDetails.tsx',
  'VaultUsageView.tsx',
  'VaultActivityView.tsx',
]
  .map((file) => readFileSync(new URL(file, import.meta.url), 'utf8'))
  .join('\n')

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
    expect(container.innerHTML).not.toContain('rounded-xl')
    expect(container.innerHTML).not.toContain('bg-muted/15')
    expect(container.querySelector('button[draggable="true"]')?.innerHTML).not.toContain(
      'bg-surface-raised',
    )
    expect(source).not.toContain('<Badge')
    expect(source).not.toContain("from '@/shared/ui/badge'")
    expect(source).not.toContain('rounded-lg border border-border/45 bg-background/65')
    expect(source).toContain('border-y border-border-faint')

    await act(async () => {
      findButton(container, 'Usage')?.click()
      await settle()
    })
    expect(container.textContent).toContain('Consumer map')
    expect(container.textContent).toContain('Linear')
    expect(container.innerHTML).toContain('bg-status-success')
    expect(container.innerHTML).not.toContain('bg-background/70')

    await act(async () => {
      findButton(container, 'Activity')?.click()
      await settle()
    })
    expect(container.textContent).toContain('Vault activity')
    expect(container.textContent).toContain('resolve')
    expect(container.innerHTML).not.toContain('bg-muted/10')

    await act(async () => root.unmount())
    list.mockRestore()
    bindings.mockRestore()
    activity.mockRestore()
  })

  test('survives a narrow side panel: nothing clipped, nothing truncated that must be read', () => {
    // The Vault is opened as an editor tab AND as a right-hand panel, and the panel is where the
    // geometry used to fall apart: four summary metrics in a fixed-height clipped bar, three
    // fixed-width filters in a wrapping flex, and a right-aligned truncating value column that
    // made the alias — the one field people come here to copy — permanently an ellipsis.

    // The summary keeps every metric by wrapping instead of clipping the tail.
    expect(source).toContain('<WorkbenchStatusBar aria-label="Vault summary" seam="bottom" wrap>')

    // The search flexes beside ONE filter menu, not a row of fixed-width framed selects.
    expect(source).toContain(
      'placeholder="Search names, aliases, tags…"\n          className="min-w-0 flex-1"',
    )
    expect(source).toContain('<FilterMenu')
    expect(source).not.toContain('aria-label="Filter by type"')

    // Long values wrap where they are read, and mono identifiers break inside the token —
    // an alias has no spaces to break at.
    expect(source).toContain("mono ? 'font-mono break-all' : 'wrap-anywhere'")
    expect(source).toContain('font-mono text-xs break-all text-foreground')
    expect(source).not.toContain('truncate text-right text-muted-foreground')

    // Every flex/grid child that holds text opts out of the `min-width: auto` default.
    expect(source).toContain('<div className="grid min-w-0 gap-4 @sm:gap-5">')
    expect(source).toContain('<div className="flex min-w-0 items-start gap-2.5">')
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
