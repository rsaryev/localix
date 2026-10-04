import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type * as Monaco from 'monaco-editor'
import { registerDom } from '@localixai/kit/testing/dom'
import { adoptStickyScrollMaterial } from './stickyMaterial'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(() => teardown())

const editorFor = (root: HTMLElement) =>
  ({ getDomNode: () => root }) as Monaco.editor.IStandaloneCodeEditor

async function mutate(root: HTMLElement, html: string) {
  // Wait for DOM delivery itself: one timer tick can run before happy-dom's
  // MutationObserver callback when this suite follows other DOM tests.
  await new Promise<void>((resolve) => {
    const delivery = new MutationObserver(() => {
      delivery.disconnect()
      resolve()
    })
    delivery.observe(root, { childList: true, subtree: true })
    root.innerHTML = html
  })
}

describe('native sticky scroll material', () => {
  test('adopts the shared occluder on existing widgets without painting the editor body', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div class="sticky-widget"><div class="sticky-line-content"></div></div>'
    const material = adoptStickyScrollMaterial(editorFor(root))
    try {
      expect(root.querySelector('.sticky-widget')?.classList.contains('lx-occluder')).toBe(true)
      expect(root.classList.contains('lx-occluder')).toBe(false)
      expect(root.querySelector('.sticky-line-content')?.classList.contains('lx-occluder')).toBe(
        false,
      )
    } finally {
      material.dispose()
    }
  })

  test('covers lazy and replacement widgets, including peek, and disconnects on unmount', async () => {
    const root = document.createElement('div')
    const material = adoptStickyScrollMaterial(editorFor(root))
    try {
      await mutate(root, '<div class="sticky-widget"></div>')
      expect(root.querySelector('.sticky-widget')?.classList.contains('lx-occluder')).toBe(true)
      await mutate(root, '<div><div class="sticky-widget peek"></div></div>')
      expect(root.querySelector('.sticky-widget.peek')?.classList.contains('lx-occluder')).toBe(
        true,
      )
      material.dispose()
      await mutate(root, '<div class="sticky-widget"></div>')
      expect(root.querySelector('.sticky-widget')?.classList.contains('lx-occluder')).toBe(false)
    } finally {
      material.dispose()
    }
  })
})
