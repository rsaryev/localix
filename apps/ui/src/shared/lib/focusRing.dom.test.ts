import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { currentFocusPart, focusPart } from './focusRing'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(async () => {
  await teardown()
})

test('F6 walks the parts present, wrapping, and lands on each part’s own target', () => {
  document.body.innerHTML = `
    <nav data-focus-part="sidebar"><input type="file" /><button id="row">Row</button></nav>
    <section data-focus-part="chat"><textarea id="composer"></textarea></section>
    <div id="outside" tabindex="0"></div>`
  try {
    document.getElementById('outside')!.focus()
    expect(currentFocusPart()).toBeNull()

    focusPart(1)
    expect(document.activeElement?.id).toBe('row')
    expect(currentFocusPart()).toBe('sidebar')

    focusPart(1)
    expect(document.activeElement?.id).toBe('composer')
    expect(currentFocusPart()).toBe('chat')

    focusPart(1)
    expect(currentFocusPart()).toBe('sidebar')
    focusPart(-1)
    expect(currentFocusPart()).toBe('chat')
  } finally {
    document.body.innerHTML = ''
  }
})
