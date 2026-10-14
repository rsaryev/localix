/**
 * The embedded actuator drives ONE panel of a host document. Each case pins what escaping the
 * panel would cost: a snapshot listing the host's own chrome, a selector clicking the host's
 * button, a Tab walking out into the host, a console full of the host's logs.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { createConsoleBuffer, createEmbeddedActuator } from './index'

describe('embedded actuator', () => {
  beforeAll(() => GlobalRegistrator.register())
  afterAll(() => GlobalRegistrator.unregister())

  function hostWithPanel() {
    document.body.innerHTML = `
      <nav><button id="host-send">Send message</button></nav>
      <section id="panel" aria-label="Focus Timer">
        <p>25:00</p>
        <button id="start">Start</button>
        <input id="minutes" aria-label="Minutes" />
      </section>`
    const clicks: string[] = []
    for (const id of ['host-send', 'start']) {
      document.getElementById(id)!.addEventListener('click', () => clicks.push(id))
    }
    return { panel: document.getElementById('panel')!, clicks }
  }

  test('a snapshot lists the panel and nothing of the host around it', async () => {
    const { panel } = hostWithPanel()
    const actuator = createEmbeddedActuator({ console: createConsoleBuffer() })
    const result = await actuator.run({ action: 'snapshot' }, panel)
    expect(result.ok).toBe(true)
    const tree = result.result?.snapshot?.tree ?? ''
    expect(tree).toContain('Start')
    expect(tree).toContain('25:00')
    expect(tree).not.toContain('Send message')
    expect(result.result?.snapshot?.title).toBe('Focus Timer')
  })

  test('a ref from that snapshot clicks inside the panel, and a selector cannot leave it', async () => {
    const { panel, clicks } = hostWithPanel()
    const actuator = createEmbeddedActuator({ console: createConsoleBuffer() })
    const tree = (await actuator.run({ action: 'snapshot' }, panel)).result?.snapshot?.tree ?? ''
    const ref = /button "Start".*\[ref=(e\d+)\]/u.exec(tree)?.[1]
    expect(ref).toBeDefined()
    const click = await actuator.run({ action: 'steps', steps: [{ action: 'click', ref }] }, panel)
    expect(click.ok).toBe(true)
    expect(clicks).toEqual(['start'])

    // `button` would match the host's own button first in document order.
    const escaped = await actuator.run(
      { action: 'steps', steps: [{ action: 'click', selector: '#host-send' }] },
      panel,
    )
    expect(escaped.ok).toBe(false)
    expect(clicks).toEqual(['start'])
  })

  test('console reads the buffer the host fills, never the window console', async () => {
    const { panel } = hostWithPanel()
    const buffer = createConsoleBuffer()
    const actuator = createEmbeddedActuator({ console: buffer })
    console.warn('the host is logging about itself')
    buffer.record('error', 'TypeError: timer is undefined')
    const result = await actuator.run({ action: 'console' }, panel)
    expect(result.result?.console).toEqual([
      { level: 'error', text: 'TypeError: timer is undefined' },
    ])
  })
})
