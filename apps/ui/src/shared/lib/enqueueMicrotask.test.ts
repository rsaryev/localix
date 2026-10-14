import { describe, expect, test } from 'bun:test'
import { enqueueMicrotask, type MicrotaskHost } from './enqueueMicrotask'

describe('enqueueMicrotask', () => {
  test('calls a Web-IDL-style scheduler with its host as the receiver', () => {
    let receiverWasHost = false
    let ran = false
    const host: MicrotaskHost = {
      queueMicrotask(this: MicrotaskHost, callback) {
        receiverWasHost = this === host
        callback()
      },
    }

    enqueueMicrotask(() => {
      ran = true
    }, host)

    expect(receiverWasHost).toBe(true)
    expect(ran).toBe(true)
  })
})
