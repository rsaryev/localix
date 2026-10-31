/**
 * The page's own requests in flight tell "the DOM is quiet because it is done" from "quiet
 * because the answer has not arrived". The tracker only watches: the page's fetch and XHR must
 * behave exactly as before. Time is injected.
 */
import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { installInflightTracker } from './inflight'

beforeAll(() => {
  GlobalRegistrator.register({ url: 'https://shop.example/search' })
})
afterAll(() => GlobalRegistrator.unregister())

let t = 0
const clock = () => t
beforeEach(() => {
  t = 0
})

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

test('an own-origin fetch counts until it settles', async () => {
  const reply = deferred<Response>()
  const original = window.fetch
  window.fetch = (() => reply.promise) as unknown as typeof window.fetch
  const tracker = installInflightTracker(window, clock)
  try {
    const call = window.fetch('/api/results?q=a')
    expect(tracker.pending()).toBe(true)
    reply.resolve(new Response('ok'))
    await call
    await Promise.resolve()
    expect(tracker.pending()).toBe(false)
  } finally {
    tracker.restore()
    window.fetch = original
  }
})

test('the page sees its own fetch result and rejection untouched', async () => {
  const original = window.fetch
  const seen: unknown[][] = []
  const failure = new Error('offline')
  const ok = new Response('body')
  window.fetch = ((...args: unknown[]) => {
    seen.push(args)
    return args[0] === '/ok' ? Promise.resolve(ok) : Promise.reject(failure)
  }) as unknown as typeof window.fetch
  const tracker = installInflightTracker(window, clock)
  try {
    const init = { method: 'POST' }
    expect(await window.fetch('/ok', init)).toBe(ok)
    expect(seen[0]).toEqual(['/ok', init])
    await expect(window.fetch('/down')).rejects.toBe(failure)
    await Promise.resolve()
    expect(tracker.pending()).toBe(false)
  } finally {
    tracker.restore()
    window.fetch = original
  }
})

test('third-party traffic is not the page content', () => {
  const original = window.fetch
  window.fetch = (() => new Promise(() => {})) as unknown as typeof window.fetch
  const tracker = installInflightTracker(window, clock)
  try {
    void window.fetch('https://ads.example/pixel')
    expect(tracker.pending()).toBe(false)
    void window.fetch(new Request('https://shop.example/api/items'))
    expect(tracker.pending()).toBe(true)
  } finally {
    tracker.restore()
    window.fetch = original
  }
})

test('a request older than five seconds is a long poll, not a pending result', () => {
  const original = window.fetch
  window.fetch = (() => new Promise(() => {})) as unknown as typeof window.fetch
  const tracker = installInflightTracker(window, clock)
  try {
    void window.fetch('/events')
    t = 4999
    expect(tracker.pending()).toBe(true)
    t = 5001
    expect(tracker.pending()).toBe(false)
  } finally {
    tracker.restore()
    window.fetch = original
  }
})

test('an XHR counts from send to loadend and still reaches the native methods', async () => {
  const proto = XMLHttpRequest.prototype
  const originalOpen = proto.open
  const originalSend = proto.send
  const calls: string[] = []
  proto.open = function (method: string, url: string | URL) {
    calls.push(`open ${method} ${String(url)}`)
  } as typeof proto.open
  proto.send = function () {
    calls.push('send')
  } as typeof proto.send
  const tracker = installInflightTracker(window, clock)
  try {
    const xhr = new XMLHttpRequest()
    xhr.open('GET', '/api/page/2')
    xhr.send()
    expect(calls).toEqual(['open GET /api/page/2', 'send'])
    expect(tracker.pending()).toBe(true)
    xhr.dispatchEvent(new Event('loadend'))
    await Promise.resolve()
    expect(tracker.pending()).toBe(false)
  } finally {
    tracker.restore()
    proto.open = originalOpen
    proto.send = originalSend
  }
})

test('restore leaves a wrapper the page installed after the tracker in place', () => {
  const original = window.fetch
  const proto = XMLHttpRequest.prototype
  const originalOpen = proto.open
  const originalSend = proto.send
  const tracker = installInflightTracker(window, clock)
  const theirFetch = (() => Promise.resolve(new Response('mine'))) as unknown as typeof window.fetch
  const theirOpen = function () {} as typeof proto.open
  const theirSend = function () {} as typeof proto.send
  window.fetch = theirFetch
  proto.open = theirOpen
  proto.send = theirSend
  try {
    tracker.restore()
    expect(window.fetch).toBe(theirFetch)
    expect(proto.open).toBe(theirOpen)
    expect(proto.send).toBe(theirSend)
  } finally {
    window.fetch = original
    proto.open = originalOpen
    proto.send = originalSend
  }
})

test('restore puts the originals back when nothing wrapped the tracker', () => {
  const original = window.fetch
  const originalSend = XMLHttpRequest.prototype.send
  const tracker = installInflightTracker(window, clock)
  expect(window.fetch).not.toBe(original)
  tracker.restore()
  expect(window.fetch).toBe(original)
  expect(XMLHttpRequest.prototype.send).toBe(originalSend)
})
