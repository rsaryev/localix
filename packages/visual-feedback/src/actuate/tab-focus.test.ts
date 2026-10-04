/**
 * `press Tab` must move focus the way a real key does. A constructed KeyboardEvent is
 * untrusted, so the browser runs no default action for it: before this, Tab left focus
 * where it was and every focus-trap check an agent ran read `document.activeElement` as
 * BODY — a false failure the agent could not tell apart from a real one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { createRefRegistry } from '../snapshot/index'
import { installConsoleCapture, runCommand, type ActuateDeps } from './index'

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())

function deps(): ActuateDeps {
  return { reg: createRefRegistry(), console: installConsoleCapture(), prevTree: { value: '' } }
}

const active = () => (document.activeElement as HTMLElement | null)?.id || 'body'

function page(html: string, focusId?: string) {
  document.body.innerHTML = html
  if (focusId) document.getElementById(focusId)!.focus()
}

describe('press Tab moves focus', () => {
  it('walks tabbable controls forward and back, skipping disabled, hidden and tabindex=-1', async () => {
    page(
      `<button id="a">A</button><button id="off" disabled>X</button>
       <div hidden><button id="gone">G</button></div><span id="skip" tabindex="-1">S</span>
       <input id="b"><a id="c" href="#">C</a>`,
      'a',
    )
    await runCommand({ action: 'press', key: 'Tab' }, deps())
    expect(active()).toBe('b')
    await runCommand({ action: 'press', keys: ['Tab'] }, deps())
    expect(active()).toBe('c')
    await runCommand({ action: 'press', key: 'Shift+Tab' }, deps())
    expect(active()).toBe('b')
  })

  it('a key sequence targets the newly focused element each time', async () => {
    page('<button id="a">A</button><button id="b">B</button><button id="c">C</button>', 'a')
    await runCommand({ action: 'press', keys: ['Tab', 'Tab'] }, deps())
    expect(active()).toBe('c')
  })

  it('leaves focus to the page when its keydown handler prevents the default (a focus trap)', async () => {
    page('<button id="a">A</button><button id="b">B</button><button id="c">C</button>', 'b')
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      event.preventDefault()
      document.getElementById('a')!.focus()
    }
    document.addEventListener('keydown', trap)
    await runCommand({ action: 'press', key: 'Tab' }, deps())
    document.removeEventListener('keydown', trap)
    expect(active()).toBe('a')
  })

  it('positive tabindex comes first, and Tab from the last control leaves the page', async () => {
    page('<button id="late">L</button><button id="first" tabindex="1">F</button>')
    await runCommand({ action: 'press', key: 'Tab' }, deps())
    expect(active()).toBe('first')
    await runCommand({ action: 'press', key: 'Tab' }, deps())
    expect(active()).toBe('late')
    await runCommand({ action: 'press', key: 'Tab' }, deps())
    expect(active()).toBe('body')
  })
})
