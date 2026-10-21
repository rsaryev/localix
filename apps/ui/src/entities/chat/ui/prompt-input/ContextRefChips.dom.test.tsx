import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { MessageContextBinding } from '@/shared/api/contracts'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('context manifest', () => {
  test('shows system bindings in the same context manifest and lets the user exclude one', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { ContextRefChips } = await import('./ContextRefChips')
    const systemBinding: MessageContextBinding = {
      kind: 'context',
      id: 'system-1',
      source: 'system',
      target: {
        kind: 'system-event',
        token: 'notice:model_change:participant:lead',
        label: '@lead is now on model-b.',
      },
      resolution: { status: 'resolved', contributions: [] },
    }
    const changes: Array<[string, boolean]> = []
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    try {
      await act(async () => {
        root.render(
          <ContextRefChips
            chips={[]}
            budget="ok"
            budgetMessage={null}
            systemBindings={[systemBinding]}
            enabledSystemBindingIds={new Set(['system-1'])}
            onSystemBindingEnabledChange={(id, enabled) => changes.push([id, enabled])}
            onRemove={() => {}}
            onClearAll={() => {}}
          />,
        )
      })
      const trigger = host.querySelector<HTMLButtonElement>(
        'button[aria-label="Review 1 included context item"]',
      )
      expect(trigger).not.toBeNull()
      await act(async () => trigger!.click())
      const exclude = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Exclude system context @lead is now on model-b."]',
      )
      expect(exclude).not.toBeNull()
      await act(async () => exclude!.click())
      expect(changes).toEqual([['system-1', false]])
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
