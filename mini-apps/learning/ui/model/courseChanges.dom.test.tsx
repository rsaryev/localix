import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import { miniAppRealtime } from '@localixai/mini-app-sdk/ui/runtime'
import { COURSE_BACKSTOP_MS, applyCourseChange, useCourseChanges } from './courseChanges'

let teardown: () => Promise<void>
let restoreRealtime: () => void
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
beforeAll(() => {
  teardown = registerDom()
  // These tests drive invalidation and polling; no host websocket should be opened.
  const realtime = [
    spyOn(miniAppRealtime, 'onFrame').mockReturnValue(() => {}),
    spyOn(miniAppRealtime, 'onReconnect').mockReturnValue(() => {}),
    spyOn(miniAppRealtime, 'onDisconnect').mockReturnValue(() => {}),
    spyOn(miniAppRealtime, 'request').mockResolvedValue(undefined),
  ]
  restoreRealtime = () => realtime.forEach((method) => method.mockRestore())
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  restoreRealtime()
  await teardown()
  delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
})

/**
 * A course and the library re-read on a raw 5 s `setInterval`, in a background window too, to
 * catch the agent's changes. The agent's change is now heard for its own chat only, and what is
 * left polling is the visibility-gated backstop.
 */
test('the agent’s change re-reads its own chat’s courses; the poll is only the backstop', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const delays: Array<number | undefined> = []
  const realSetInterval = globalThis.setInterval
  const timer = spyOn(globalThis, 'setInterval').mockImplementation(((
    handler: () => void,
    ms?: number,
  ) => {
    delays.push(ms)
    return realSetInterval(handler, 3_600_000)
  }) as typeof setInterval)
  let reads = 0
  function Probe() {
    useCourseChanges('chat-1', true, async () => {
      reads += 1
    })
    return null
  }
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => root.render(<Probe />))
    expect(delays).toEqual([COURSE_BACKSTOP_MS])

    await act(async () => applyCourseChange({ sessionId: 'chat-2', payload: { courseId: 'c' } }))
    expect(reads).toBe(0)
    await act(async () => applyCourseChange({ sessionId: 'chat-1', payload: { courseId: 'c' } }))
    expect(reads).toBe(1)
    await act(async () => applyCourseChange({ sessionId: 'chat-1', payload: { courseId: 7 } }))
    expect(reads, 'a frame that is not a course change is ignored').toBe(1)
  } finally {
    await act(async () => root.unmount())
    timer.mockRestore()
  }
})
