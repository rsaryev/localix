import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '../testing/dom'
import { createActionFeedbackStore } from './action-feedback-store'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('the action feedback clock', () => {
  test('an answer expires on its own, and a newer one replaces it and restarts the clock', async () => {
    const store = createActionFeedbackStore(40)
    store.show('Copied', { tone: 'success' })
    expect(store.getSnapshot()).toMatchObject({ message: 'Copied', tone: 'success' })
    await wait(25)
    store.show('Copied again')
    await wait(25)
    // 50ms after the first show, but only 25ms after the second: still there, and it is the newer.
    expect(store.getSnapshot()).toMatchObject({ message: 'Copied again', tone: 'info' })
    await wait(30)
    expect(store.getSnapshot()).toBeNull()
  })

  test('holding stops the clock, and releasing restarts it in full', async () => {
    const store = createActionFeedbackStore(30)
    store.show('Nothing to undo')
    store.hold(true)
    await wait(50)
    expect(store.getSnapshot()?.message).toBe('Nothing to undo')
    store.hold(false)
    await wait(15)
    expect(store.getSnapshot()?.message).toBe('Nothing to undo')
    await wait(30)
    expect(store.getSnapshot()).toBeNull()
  })

  test('a repeat of the same sentence is a new answer', () => {
    const store = createActionFeedbackStore()
    store.show('Copied')
    const first = store.getSnapshot()?.id
    store.show('Copied')
    expect(store.getSnapshot()?.id).not.toBe(first)
    store.clear()
  })
})

describe('ActionFeedback', () => {
  test('the polite live region exists before the first answer and carries the next one', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { ActionFeedback } = await import('./action-feedback')
    const store = createActionFeedbackStore(10_000)
    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () => root.render(<ActionFeedback store={store} />))

    const region = host.querySelector('[data-slot="action-feedback"]')
    expect(region?.getAttribute('role')).toBe('status')
    expect(region?.getAttribute('aria-live')).toBe('polite')
    expect(region?.textContent).toBe('')

    let undone = 0
    await act(async () =>
      store.show('Cleared 3 queries', {
        tone: 'success',
        detail: 'Pinned queries were kept',
        action: { label: 'Undo', onClick: () => (undone += 1) },
      }),
    )
    // The same node: a region that mounts with its text is not reliably announced.
    expect(host.querySelector('[data-slot="action-feedback"]')).toBe(region)
    expect(region?.getAttribute('data-tone')).toBe('success')
    expect(region?.textContent).toContain('Cleared 3 queries')
    // The reason rides in the same region, so it is announced with the answer.
    expect(region?.textContent).toContain('Pinned queries were kept')

    const undo = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Undo')
    await act(async () => undo?.click())
    expect(undone).toBe(1)
    expect(region?.textContent).toBe('')
    await act(async () => root.unmount())
  })
})
