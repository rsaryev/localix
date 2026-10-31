/**
 * The `read` action: the page's visible text in windows, so a long article is read with one
 * cheap call per window instead of an `evaluate` the model has to write. Whitespace is
 * collapsed (the model pays per character), and the answer says where the window sits in the
 * whole so the caller knows whether to read on.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { createRefRegistry } from '../snapshot/index'
import { installConsoleCapture, runCommand, type ActuateDeps } from './index'
import { READ_LIMIT } from './read'

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())

const deps = (): ActuateDeps => ({
  reg: createRefRegistry(),
  console: installConsoleCapture(),
  prevTree: { value: '' },
  settle: async () => {},
})

const read = (offset?: number) =>
  runCommand({ action: 'read', ...(offset === undefined ? {} : { offset }) }, deps())

describe('read', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  test('returns the visible text with its whitespace collapsed', async () => {
    document.body.innerHTML = '<h1>Title</h1>\n\n   <p>First   line\n  and   more</p><p>Last</p>'
    const r = await read()
    expect(r.ok).toBe(true)
    expect(r.result?.action).toBe('read')
    expect(r.result?.read).toEqual({
      text: 'Title First line and more Last',
      offset: 0,
      total: 'Title First line and more Last'.length,
    })
  })

  test('a long page comes in windows of READ_LIMIT characters that join back into the text', async () => {
    const text = Array.from({ length: 3000 }, (_, i) => `w${i}`).join(' ')
    document.body.innerHTML = `<p>${text}</p>`
    const first = (await read()).result!.read!
    expect(first.text.length).toBe(READ_LIMIT)
    expect(first.offset).toBe(0)
    expect(first.total).toBe(text.length)
    const second = (await read(first.offset + first.text.length)).result!.read!
    expect(second.offset).toBe(READ_LIMIT)
    expect(first.text + second.text).toBe(text.slice(0, READ_LIMIT * 2))
    const last = (await read(text.length - 10)).result!.read!
    expect(last.text).toBe(text.slice(-10))
  })

  test('an offset past the end is an empty window, not an error', async () => {
    document.body.innerHTML = '<p>short</p>'
    expect((await read(9999)).result?.read).toEqual({ text: '', offset: 5, total: 5 })
  })

  test('refuses a negative or fractional offset', async () => {
    document.body.innerHTML = '<p>short</p>'
    for (const offset of [-1, 1.5]) {
      const r = await read(offset)
      expect(r.ok).toBe(false)
      expect(r.errorCode).toBe('bad_request')
    }
  })

  test('an empty page says so with a zero total', async () => {
    expect((await read()).result?.read).toEqual({ text: '', offset: 0, total: 0 })
  })

  test('reads only the scoped root when a host scopes the actuator', async () => {
    document.body.innerHTML = '<nav>menu</nav><section id="panel">the panel</section>'
    const r = await runCommand(
      { action: 'read' },
      { ...deps(), root: document.getElementById('panel')! },
    )
    expect(r.result?.read?.text).toBe('the panel')
  })
})
