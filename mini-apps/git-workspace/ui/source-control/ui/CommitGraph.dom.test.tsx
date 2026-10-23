import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import { sourceControlApi } from '../../api'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

let restore: (() => void) | undefined
afterEach(() => {
  restore?.()
  restore = undefined
})

describe('CommitGraph read failures', () => {
  test('a failed log read says why instead of claiming there are no commits', async () => {
    const spy = spyOn(sourceControlApi, 'getLog').mockImplementation(async () => {
      throw new Error("fatal: detected dubious ownership in repository at '/w'")
    })
    restore = () => spy.mockRestore()
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { CommitGraph } = await import('./CommitGraph')
    const host = document.createElement('div')
    const root = createRoot(host)

    await act(async () => root.render(<CommitGraph sessionId="s1" />))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(host.textContent).not.toContain('No commits yet.')
    expect(host.textContent).toContain('belongs to another user')
    await act(async () => root.unmount())
  })
})
