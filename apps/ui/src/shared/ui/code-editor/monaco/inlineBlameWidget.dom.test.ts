import { afterAll, beforeAll, expect, it, mock } from 'bun:test'
import type * as Monaco from 'monaco-editor'
import { registerDom } from '@localixai/kit/testing/dom'
import { createInlineBlameWidget } from './inlineBlameWidget'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(() => teardown())

it('keeps authorship visible at end of line and opens history without moving the caret', () => {
  let cursor = { lineNumber: 1, column: 2 }
  let mounted: Monaco.editor.IContentWidget | undefined
  const remove = mock(() => {})
  const editor = {
    getId: () => 'editor',
    getPosition: () => cursor,
    addContentWidget: (widget: Monaco.editor.IContentWidget) => {
      mounted = widget
    },
    layoutContentWidget: () => {},
    removeContentWidget: remove,
    // The annotation must never set cursor position or inject model decorations.
    setPosition: () => {
      throw new Error('Caret changed')
    },
    createDecorationsCollection: () => {
      throw new Error('Injected annotation')
    },
  } as unknown as Monaco.editor.IStandaloneCodeEditor
  const widget = createInlineBlameWidget(
    {
      editor: { ContentWidgetPositionPreference: { EXACT: 0 }, PositionAffinity: { Right: 1 } },
    } as never,
    editor,
    { getLineMaxColumn: () => 12 } as never,
  )
  widget.set(1, 'Ada, just now')
  expect(mounted?.getDomNode().textContent).toBe('Ada, just now')
  expect(mounted?.getPosition()?.position).toEqual({ lineNumber: 1, column: 12 })
  expect(cursor).toEqual({ lineNumber: 1, column: 2 })
  expect(mounted?.getDomNode().getAttribute('aria-hidden')).toBe('true')

  cursor = { lineNumber: 1, column: 11 } // on the trailing semicolon
  widget.set(1, 'Ada, just now')
  expect(mounted?.getPosition()?.position).toEqual({ lineNumber: 1, column: 12 })
  expect(cursor.column).toBe(11)
  cursor = { lineNumber: 1, column: 12 } // end of line, where ghost text begins
  const openDiff = mock(() => {})
  widget.set(1, 'Ada, just now', openDiff)
  expect(mounted?.getPosition()?.position).toEqual({ lineNumber: 1, column: 12 })
  expect(mounted?.getPosition()?.positionAffinity).toBe(1)
  const node = mounted!.getDomNode()
  expect(node.getAttribute('role')).toBe('button')
  expect(node.tabIndex).toBe(0)
  node.click()
  expect(openDiff).toHaveBeenCalledTimes(1)
  node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  node.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
  expect(openDiff).toHaveBeenCalledTimes(3)
  expect(cursor.column).toBe(12)
  widget.set(1, 'Not committed yet')
  node.click()
  expect(openDiff).toHaveBeenCalledTimes(3)
  expect(node.getAttribute('role')).toBeNull()
  widget.set()
  expect(mounted?.getPosition()).toBeNull()
  widget.dispose()
  expect(remove).toHaveBeenCalledWith(mounted)
})
