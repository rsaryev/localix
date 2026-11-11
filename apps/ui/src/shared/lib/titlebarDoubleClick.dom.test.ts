import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { installTitlebarDoubleClick } from './titlebarDoubleClick'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(async () => teardown())

/**
 * Tauri's drag script maximizes on every double-click of a `data-tauri-drag-region`, on mouseup,
 * whatever System Settings says the gesture does. Its listener is on the document; this one runs
 * first, on the window in the capture phase, and hands the gesture to the shell, which reads the
 * setting (`titlebar_double_click.rs`).
 */
function setup() {
  document.body.innerHTML = `
    <div data-tauri-drag-region id="bar">
      <span id="label">Title</span>
      <button id="button">Act</button>
    </div>
    <div data-tauri-drag-region="deep" id="deep"><span id="inside">Deep</span></div>
    <div data-tauri-drag-region="deep">
      <div data-tauri-drag-region="false"><span id="blocked">Off</span></div>
    </div>`
  const calls: string[] = []
  let tauriSaw = 0
  const tauri = () => tauriSaw++
  document.addEventListener('mouseup', tauri)
  const uninstall = installTitlebarDoubleClick(window, async (command) => {
    calls.push(command)
  })
  const press = (id: string, detail: number, moved = false) => {
    const target = document.getElementById(id)!
    target.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 0, detail, clientX: 5, clientY: 5 }),
    )
    target.dispatchEvent(
      new MouseEvent('mouseup', {
        bubbles: true,
        button: 0,
        detail,
        clientX: moved ? 9 : 5,
        clientY: 5,
      }),
    )
  }
  const done = () => {
    uninstall()
    document.removeEventListener('mouseup', tauri)
  }
  return { calls, press, tauriSaw: () => tauriSaw, done }
}

test('a double-click on the title row goes to the shell, and Tauri never sees it', () => {
  const { calls, press, tauriSaw, done } = setup()
  press('bar', 2)
  expect(calls).toEqual(['titlebar_double_click'])
  expect(tauriSaw()).toBe(0)
  press('inside', 2)
  expect(calls).toHaveLength(2)
  done()
})

test('a single click, a moved double-click and one off the row are left alone', () => {
  const { calls, press, tauriSaw, done } = setup()
  press('bar', 1)
  press('bar', 2, true)
  press('label', 2)
  press('button', 2)
  press('blocked', 2)
  expect(calls).toEqual([])
  expect(tauriSaw()).toBe(5)
  done()
})
