import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { workspaceDragSnapshot } from './workspaceDragSnapshot'
import type { WindowDragPacket } from './provisionalWindowDrag'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(async () => {
  await teardown()
})
afterEach(() => {
  document.body.replaceChildren()
})
const packet: WindowDragPacket = {
  route: '/project/project/session',
  payload: {
    version: 1,
    projectId: 'project',
    sessionId: 'session',
    item: { id: 'chat:session', kind: 'chat', title: 'Chat', scope: 'session' },
  },
}
function box(element: HTMLElement, x = 100, y = 50, width = 400, height = 300) {
  element.getBoundingClientRect = () => new DOMRect(x, y, width, height)
  return element
}
function panel() {
  const element = box(document.createElement('div'))
  element.setAttribute('data-work-item-id', packet.payload.item.id)
  document.body.append(element)
  return element
}

test('captures the dragged visible pane, clipped to the app viewport', () => {
  const element = panel()
  box(element, -20, -10)
  expect(workspaceDragSnapshot(packet)).toEqual({ rect: [0, 0, 380, 290] })
})

test('inactive sessions and hidden grid groups never borrow another panel picture', () => {
  const element = panel()
  element.hidden = true
  expect(workspaceDragSnapshot(packet)).toBeUndefined()
  element.hidden = false
  element.setAttribute('data-grid-hidden', '')
  expect(workspaceDragSnapshot(packet)).toBeUndefined()
  element.removeAttribute('data-grid-hidden')
  element.setAttribute('data-work-item-id', 'chat:other-session')
  expect(workspaceDragSnapshot(packet)).toBeUndefined()
})

test('composites only the displayed native Browser and refuses an inactive inner page', () => {
  const element = panel()
  const page = box(document.createElement('div'), 100, 90, 400, 260)
  page.setAttribute('data-browser-page-id', 'page')
  const host = box(document.createElement('div'), 100, 110, 400, 240)
  host.setAttribute('data-native-page-id', 'page')
  page.append(host)
  element.append(page)
  const browser = { sessionId: 'session', activeId: 'page', tabs: [] }
  expect(workspaceDragSnapshot({ ...packet, payload: { ...packet.payload, browser } })).toEqual({
    rect: [100, 50, 400, 300],
    browser: { pageId: 'page', rect: [100, 110, 400, 240] },
  })
  expect(
    workspaceDragSnapshot({
      ...packet,
      payload: { ...packet.payload, browser: { ...browser, activeId: 'other' } },
    }),
  ).toBeUndefined()
})

test('Browser composition uses the same ancestor clipping as the native page', () => {
  const element = panel()
  element.style.overflow = 'hidden'
  const page = box(document.createElement('div'), 100, 50, 400, 300)
  page.setAttribute('data-browser-page-id', 'page')
  const host = box(document.createElement('div'), 80, 100, 800, 600)
  host.setAttribute('data-native-page-id', 'page')
  page.append(host)
  element.append(page)
  const browser = { sessionId: 'session', activeId: 'page', tabs: [] }
  expect(
    workspaceDragSnapshot({ ...packet, payload: { ...packet.payload, browser } })?.browser,
  ).toEqual({
    pageId: 'page',
    rect: [100, 100, 400, 250],
  })
})
