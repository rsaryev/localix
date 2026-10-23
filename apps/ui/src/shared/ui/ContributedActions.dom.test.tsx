import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { WorkItemSessionProvider } from '@localixai/mini-app-sdk/ui/work-item-session'
import { ActionSurfaceProvider } from '@localixai/mini-app-sdk/ui'
import { bindMiniAppUiTestDoubles } from '@localixai/mini-app-sdk/ui/testing'
import { registerAction, removeActionsOf } from '@/shared/contrib/actions'
import { setEnabledMiniAppNames } from '@/shared/contrib/miniAppActivation'
import { ContributedActions } from './ContributedActions'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

test('mini app eligibility hides and restores a button live; fast clicks run once and subscriptions release', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const unbind = bindMiniAppUiTestDoubles()
  const listeners = new Set<() => void>()
  let needed = true
  let runs = 0
  let finish!: () => void
  const pending = new Promise<void>((done) => {
    finish = done
  })
  setEnabledMiniAppNames(new Set(['live-action']))
  registerAction({
    id: 'live-action:save',
    miniAppName: 'live-action',
    label: 'Save',
    Icon: () => null,
    when: () => needed,
    subscribe: (context, onChange) => {
      expect(context.sessionId).toBe('origin')
      listeners.add(onChange)
      return () => {
        listeners.delete(onChange)
      }
    },
    run: async () => {
      runs++
      await pending
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const change = async (value: boolean) =>
    act(async () => {
      needed = value
      for (const listener of listeners) listener()
    })
  try {
    await act(async () =>
      root.render(
        <WorkItemSessionProvider sessionId="origin">
          <ActionSurfaceProvider surface="chat.content">
            <ContributedActions target={{ kind: 'code', text: 'source' }} />
          </ActionSurfaceProvider>
        </WorkItemSessionProvider>,
      ),
    )
    expect(listeners.size).toBe(1)
    const button = host.querySelector<HTMLButtonElement>('button')!
    await act(async () => {
      button.click()
      button.click()
    })
    expect(runs).toBe(1)
    expect(host.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true)
    await change(false)
    expect(host.querySelector('button')).toBeNull()
    await act(async () => {
      finish()
      await pending
    })
    await change(true)
    expect(host.querySelector('button[aria-label="Save"]')).not.toBeNull()
    await act(async () => removeActionsOf('live-action'))
    expect(listeners.size).toBe(0)
    expect(host.querySelector('button')).toBeNull()
  } finally {
    finish()
    await act(async () => root.unmount())
    host.remove()
    removeActionsOf('live-action')
    setEnabledMiniAppNames(null)
    unbind()
  }
})
