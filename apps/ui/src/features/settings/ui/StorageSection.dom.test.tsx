import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'

import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const usage = {
  fileBytes: 120 * 1024 * 1024,
  walBytes: 0,
  freeBytes: 0,
  messageBytes: 60 * 1024 * 1024,
  toolOutputBytes: 10 * 1024 * 1024,
  toolOutputRawBytes: 22 * 1024 * 1024,
  searchIndexBytes: 0,
}
const prune = mock(async (input: { olderThanDays: number; dryRun: boolean }) => ({
  sessions: 2,
  bytes: 5 * 1024 * 1024,
  dryRun: input.dryRun,
  failed: 0,
}))
void mock.module('@/shared/api/storageApi', () => ({
  storageApi: { usage: async () => usage, prune },
}))

describe('StorageSection', () => {
  test('shows disk use, counts before it removes, and removes nothing without a confirmation', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { StorageSection } = await import('./StorageSection')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<StorageSection />)
    })
    expect(container.textContent).toContain('120 MB on disk')
    expect(container.textContent).toContain('Conversation history 60.0 MB')
    expect(container.textContent).toContain('compression saves 12.0 MB')
    expect(container.textContent).toContain('Off. History is kept until you remove it.')

    const review = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Review')
    await act(async () => review?.click())
    expect(prune).toHaveBeenCalledTimes(1)
    expect(prune).toHaveBeenCalledWith({ olderThanDays: 90, dryRun: true })
    expect(container.textContent).toContain(
      '2 conversations, about 5.0 MB of history, would be removed.',
    )

    const remove = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Remove…',
    )
    expect(remove).toBeDefined()
    await act(async () => remove?.click())
    // Only the count has run: the dialog is open and nothing was deleted.
    expect(prune.mock.calls.every(([input]) => input.dryRun)).toBe(true)

    await act(async () => root.unmount())
  })
})
