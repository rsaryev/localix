import { afterAll, afterEach, beforeAll, expect, jest, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { DragEvent } from 'react'
import { STALE_DRAG_MS, useComposerDropzone, type ComposerDropzone } from './useComposerDropzone'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())
afterEach(() => {
  jest.useRealTimers()
})

// An OS file drag as the composer sees it on dragenter.
const fileDragEnter = {
  dataTransfer: { types: ['Files'] },
  preventDefault() {},
} as never as DragEvent

async function mountDropzone() {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const state: { current?: ComposerDropzone } = {}
  function Host() {
    const dropzone = useComposerDropzone({ attachEnabled: true, onAddFiles: () => {} })
    React.useEffect(() => {
      state.current = dropzone
    })
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () => root.render(<Host />))
  const enter = () => React.act(async () => state.current!.handleDragEnter(fileDragEnter))
  const unmount = async () => {
    await React.act(async () => root.unmount())
    host.remove()
  }
  return { React, state, enter, unmount }
}

test('pointer movement clears a drag that ended outside the window without any event', async () => {
  const { React, state, enter, unmount } = await mountDropzone()
  try {
    await enter()
    expect(state.current!.dragKind).not.toBeNull()
    await React.act(async () => {
      window.dispatchEvent(new window.Event('pointermove'))
    })
    expect(state.current!.dragKind).toBeNull()
  } finally {
    await unmount()
  }
})

test('a drag silent for longer than the stale window clears, while dragover keeps it alive', async () => {
  const { React, state, enter, unmount } = await mountDropzone()
  jest.useFakeTimers()
  try {
    await enter()
    await React.act(async () => {
      jest.advanceTimersByTime(STALE_DRAG_MS - 300)
      window.dispatchEvent(new window.Event('dragover'))
      jest.advanceTimersByTime(400)
    })
    expect(state.current!.dragKind).not.toBeNull()
    await React.act(async () => {
      jest.advanceTimersByTime(STALE_DRAG_MS + 100)
    })
    expect(state.current!.dragKind).toBeNull()
  } finally {
    await unmount()
  }
})
