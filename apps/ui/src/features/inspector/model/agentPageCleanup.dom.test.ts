import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { PreviewEntry } from './preview'
import {
  AGENT_PAGE_IDLE_MS,
  leftByFailedRun,
  leftIdle,
  nativePageOnScreen,
  noteAgentActivity,
  resetAgentActivity,
} from './agentPageCleanup'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(async () => teardown())
beforeEach(() => resetAgentActivity())

const page = (previewId: string, extra: Partial<PreviewEntry> = {}): PreviewEntry => ({
  previewId,
  url: `https://${previewId}.example/`,
  version: 1,
  originSessionId: 's1',
  ...extra,
})

const entries = [
  page('flights'),
  page('mine', { userOpened: true }),
  page('other', { originSessionId: 's2' }),
  page('shown'),
  page('local', { url: 'http://localhost:5173/' }),
]
const onScreen = (id: string) => id === 'shown'

describe('pages a failed run left behind', () => {
  test('close: the agent pages of that run that are off screen, nothing else', () => {
    expect(leftByFailedRun({ entries, sessionId: 's1', onScreen, desktop: true })).toEqual([
      'flights',
    ])
  })

  test('outside the desktop app there are no native pages to close', () => {
    expect(leftByFailedRun({ entries, sessionId: 's1', onScreen, desktop: false })).toEqual([])
  })
})

describe('the idle backstop', () => {
  const sweep = (now: number, running: (id: string) => boolean = () => false) =>
    leftIdle({ entries, now, onScreen, running, desktop: true })

  test('an off-screen agent page undriven for the idle span closes; the first look starts its clock', () => {
    expect(sweep(0)).toEqual([])
    expect(sweep(AGENT_PAGE_IDLE_MS - 1)).toEqual([])
    expect(sweep(AGENT_PAGE_IDLE_MS)).toEqual(['flights', 'other'])
  })

  test('a page an agent drove recently, or whose session is running, stays', () => {
    sweep(0)
    noteAgentActivity('flights', AGENT_PAGE_IDLE_MS - 10)
    expect(sweep(AGENT_PAGE_IDLE_MS, (id) => id === 's2')).toEqual([])
  })

  test('a page on screen restarts its clock when it leaves the screen', () => {
    sweep(0)
    expect(sweep(AGENT_PAGE_IDLE_MS)).not.toContain('shown')
    const hidden = leftIdle({
      entries,
      now: AGENT_PAGE_IDLE_MS + 1,
      onScreen: () => false,
      running: () => false,
      desktop: true,
    })
    expect(hidden).not.toContain('shown')
  })
})

describe('on screen', () => {
  test('a laid-out box inside the window is on screen; an off-screen host or no box is not', () => {
    document.body.innerHTML =
      '<div data-native-page-id="a"></div><div data-native-page-id="b"></div>'
    const [a, b] = Array.from(document.querySelectorAll<HTMLElement>('[data-native-page-id]'))
    const rect = (left: number) =>
      ({ left, top: 0, right: left + 400, bottom: 300, width: 400, height: 300 }) as DOMRect
    a!.getBoundingClientRect = () => rect(10)
    b!.getBoundingClientRect = () => rect(-10000)
    expect(nativePageOnScreen('a')).toBe(true)
    expect(nativePageOnScreen('b')).toBe(false)
    expect(nativePageOnScreen('c')).toBe(false)
  })
})
