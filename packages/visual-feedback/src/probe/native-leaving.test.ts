/**
 * A native page says it is leaving before the shell can: on a link click or a form submit nothing
 * cancelled, on a Navigation API navigation to another document, and on unload. A hash jump, a
 * history push or a download leaves the document where it is.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { trackLeaving } from './native-leaving'

beforeAll(() => GlobalRegistrator.register({ url: 'https://example.com/a?x=1' }))
afterAll(() => GlobalRegistrator.unregister())

const fresh = () => {
  // happy-dom follows a link it was clicked on: every test starts on the same page.
  ;(window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(
    'https://example.com/a?x=1',
  )
  let now = 1000
  const nav = new EventTarget()
  const leaving = trackLeaving(window, nav, () => now)
  return { leaving, nav, advance: (ms: number) => (now += ms) }
}

function link(href: string, attrs: Record<string, string> = {}) {
  const a = document.createElement('a')
  a.href = href
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v)
  document.body.appendChild(a)
  return a
}
const click = (a: Element) =>
  a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

test('a click on a link to another page reads as leaving, and fades', () => {
  const { leaving, advance } = fresh()
  expect(leaving()).toBe(false)
  click(link('https://example.com/b'))
  expect(leaving()).toBe(true)
  advance(3000)
  expect(leaving()).toBe(false)
})

test('a hash link, a download, a new tab, a mail link or a cancelled click do not leave', () => {
  const { leaving } = fresh()
  click(link('https://example.com/a?x=1#top'))
  click(link('https://example.com/f.zip', { download: '' }))
  click(link('https://example.com/c', { target: '_blank' }))
  click(link('mailto:a@b.c'))
  const cancelled = link('https://example.com/d')
  cancelled.addEventListener('click', (e) => e.preventDefault())
  click(cancelled)
  expect(leaving()).toBe(false)
})

test('a form submit nobody cancelled reads as leaving; a cancelled one does not', () => {
  const a = fresh()
  const form = document.createElement('form')
  document.body.appendChild(form)
  form.addEventListener('submit', (e) => e.preventDefault(), { once: true })
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  expect(a.leaving()).toBe(false)
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  expect(a.leaving()).toBe(true)
})

test('the Navigation API tells a document change from a same-document one', () => {
  const { leaving, nav, advance } = fresh()
  const navigate = (init: Record<string, unknown>) =>
    nav.dispatchEvent(Object.assign(new Event('navigate'), init))
  navigate({ destination: { sameDocument: true }, hashChange: false, downloadRequest: null })
  navigate({ destination: { sameDocument: false }, hashChange: true, downloadRequest: null })
  navigate({ destination: { sameDocument: false }, hashChange: false, downloadRequest: 'f.zip' })
  expect(leaving()).toBe(false)
  navigate({ destination: { sameDocument: false }, hashChange: false, downloadRequest: null })
  expect(leaving()).toBe(true)
  advance(3000)
  expect(leaving()).toBe(false)
})

test('an unload reads as leaving', () => {
  const { leaving } = fresh()
  window.dispatchEvent(new Event('beforeunload'))
  expect(leaving()).toBe(true)
})
