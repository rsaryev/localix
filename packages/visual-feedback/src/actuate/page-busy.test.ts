/** "Page still loading": what the probe tells the model when the page says it is not done. */
import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { attachBusy, isPageBusy } from './page-busy'

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())

const idle = { pending: () => false }
const fetching = { pending: () => true }

/** happy-dom has no layout: give the element a box inside the viewport. */
function laidOut(el: Element) {
  el.getBoundingClientRect = () => new DOMRect(10, 10, 100, 20)
}

beforeEach(() => {
  document.body.innerHTML = '<main><button>Search</button></main>'
})

test('a settled page with nothing in flight is not busy', () => {
  expect(isPageBusy(idle)).toBe(false)
})

test('a request of the page in flight makes it busy', () => {
  expect(isPageBusy(fetching)).toBe(true)
})

test('a busy page body or main region, or an indeterminate progress bar, makes it busy', () => {
  document.body.innerHTML = '<main aria-busy="true"></main>'
  laidOut(document.querySelector('main')!)
  expect(isPageBusy(idle)).toBe(true)
  document.body.innerHTML = '<div role="progressbar"></div>'
  laidOut(document.querySelector('div')!)
  expect(isPageBusy(idle)).toBe(true)
  document.body.innerHTML = '<progress></progress>'
  laidOut(document.querySelector('progress')!)
  expect(isPageBusy(idle)).toBe(true)
})

test('a measured progress bar or a busy widget is page content, not a page still loading', () => {
  // A media player, an upload row, a wizard step and a refreshing list say nothing about the page.
  for (const html of [
    '<progress value="30" max="100"></progress>',
    '<div role="progressbar" aria-valuenow="2" aria-valuemax="5"></div>',
    '<ul aria-busy="true"></ul>',
  ]) {
    document.body.innerHTML = html
    laidOut(document.body.firstElementChild!)
    expect(isPageBusy(idle)).toBe(false)
  }
})

test('a progress bar nobody can see (hidden, zero size, scrolled away) is not busy', () => {
  document.body.innerHTML = '<progress hidden></progress>'
  laidOut(document.querySelector('progress')!)
  expect(isPageBusy(idle)).toBe(false)
  document.body.innerHTML = '<progress></progress>'
  expect(isPageBusy(idle)).toBe(false)
  document.body.innerHTML = '<progress></progress>'
  document.querySelector('progress')!.getBoundingClientRect = () =>
    new DOMRect(10, window.innerHeight + 500, 100, 20)
  expect(isPageBusy(idle)).toBe(false)
})

test('attachBusy marks a result only when the page is busy', () => {
  const result = { action: 'click' as const }
  expect(attachBusy(result, false)).toBe(result)
  expect(attachBusy(result, true)).toEqual({ action: 'click', busy: true })
  expect(attachBusy(undefined, true)).toBeUndefined()
})
