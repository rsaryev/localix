import { afterAll, beforeAll, expect, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '@localixai/kit/testing/dom'
import { usePreviewStore } from '../model/previewStore'
import { usePreviewViewport } from './usePreviewViewport'

let teardown: () => Promise<void>
const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
let previousAct: boolean | undefined
beforeAll(() => {
  teardown = registerDom()
  previousAct = globals.IS_REACT_ACT_ENVIRONMENT
  globals.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  globals.IS_REACT_ACT_ENVIRONMENT = previousAct
  await teardown()
})

test('manual presets keep their selection while agent dimensions share the same stored frame', async () => {
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  const previous = usePreviewStore.getState()
  const sessionId = 'viewport-regression'
  const previewId = 'http://fixture.test'
  const entry = { previewId, url: previewId, version: 1, userOpened: true }
  usePreviewStore.setState({
    previewBySession: { [sessionId]: entry },
    previewTabsBySession: { [sessionId]: [entry] },
  })
  let current: ReturnType<typeof usePreviewViewport> | undefined
  function Host() {
    const viewport = usePreviewStore((s) => s.previewBySession[sessionId]?.viewport)
    current = usePreviewViewport({
      sessionId,
      previewId,
      initialViewport: viewport,
      active: true,
      backgroundHost: false,
    })
    return null
  }
  try {
    await act(async () => root.render(<Host />))
    await act(async () => current!.changeViewport({ label: 'iPhone SE', width: 375, height: 667 }))
    expect(current!.viewport).toEqual({ label: 'iPhone SE', width: 375, height: 667 })
    expect(usePreviewStore.getState().previewBySession[sessionId]?.viewport).toEqual({
      width: 375,
      height: 667,
    })
    await act(async () =>
      usePreviewStore
        .getState()
        .setPreviewViewport(sessionId, previewId, { width: 768, height: 1024 }),
    )
    expect(current!.viewport).toEqual({ label: 'Custom', width: 768, height: 1024 })
    await act(async () => usePreviewStore.getState().setPreviewViewport(sessionId, previewId, null))
    expect(current!.fixedViewport).toBe(false)
  } finally {
    await act(async () => root.unmount())
    usePreviewStore.setState(previous)
  }
})
