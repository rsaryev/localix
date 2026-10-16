import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import type * as Monaco from 'monaco-editor'

import { registerDom } from '@localixai/kit/testing/dom'
import { stabilizeFindWidgetCloseButton } from './findWidget'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
})
afterAll(() => teardown())

function editorFor(root: HTMLElement): Monaco.editor.IStandaloneCodeEditor {
  return { getDomNode: () => root } as Monaco.editor.IStandaloneCodeEditor
}

describe('stabilizeFindWidgetCloseButton', () => {
  test('suppresses the problematic close-button hover without swallowing its click', () => {
    const root = document.createElement('div')
    root.innerHTML =
      '<div class="find-widget"><div class="button codicon-widget-close"></div></div>'
    const close = root.querySelector<HTMLElement>('.codicon-widget-close')!
    const hover = mock(() => {})
    const click = mock(() => {})
    close.addEventListener('mouseover', hover)
    close.addEventListener('click', click)

    const protection = stabilizeFindWidgetCloseButton(editorFor(root))
    close.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    close.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(hover).not.toHaveBeenCalled()
    expect(click).toHaveBeenCalledTimes(1)
    protection.dispose()
  })

  test('leaves hover behavior elsewhere in the find widget unchanged', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div class="find-widget"><div class="button next"></div></div>'
    const next = root.querySelector<HTMLElement>('.next')!
    const hover = mock(() => {})
    next.addEventListener('mouseover', hover)

    const protection = stabilizeFindWidgetCloseButton(editorFor(root))
    next.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))

    expect(hover).toHaveBeenCalledTimes(1)
    protection.dispose()
  })

  test('removes the capture guard on dispose', () => {
    const root = document.createElement('div')
    root.innerHTML =
      '<div class="find-widget"><div class="button codicon-widget-close"></div></div>'
    const close = root.querySelector<HTMLElement>('.codicon-widget-close')!
    const hover = mock(() => {})
    close.addEventListener('mouseover', hover)

    const protection = stabilizeFindWidgetCloseButton(editorFor(root))
    protection.dispose()
    close.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))

    expect(hover).toHaveBeenCalledTimes(1)
  })
})
