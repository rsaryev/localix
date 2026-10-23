import { describe, expect, test } from 'bun:test'

import {
  MESSAGE_BINDING_KIND_MIME_PREFIX,
  MESSAGE_BINDING_MIME,
  WORKSPACE_TAB_DRAG_MIME,
} from '@localixai/mini-app-sdk/ui/message-binding-drag'
import { acceptedDragKind, createDragDepth } from './dropzoneState'

const callDrag = [MESSAGE_BINDING_MIME, `${MESSAGE_BINDING_KIND_MIME_PREFIX}call`, 'text/plain']

describe('acceptedDragKind', () => {
  test('message-binding drags are accepted regardless of upload support', () => {
    expect(acceptedDragKind(callDrag, { messageBinding: true, attach: true })).toBe('call')
    expect(acceptedDragKind(callDrag, { messageBinding: true, attach: false })).toBe('call')
  })

  test('message-binding drags are ignored when the host has no binding sink', () => {
    expect(acceptedDragKind(callDrag, { messageBinding: false, attach: false })).toBeNull()
    // …but OS files still work if attach is on.
    expect(acceptedDragKind(['Files'], { messageBinding: false, attach: true })).toBe('files')
  })

  test('tab drags cannot advertise links or file uploads through legacy mixed payloads', () => {
    const types = [WORKSPACE_TAB_DRAG_MIME, ...callDrag, 'Files']
    expect(acceptedDragKind(types, { messageBinding: true, attach: true })).toBeNull()
  })

  test('OS file drags gate on attachEnabled', () => {
    expect(acceptedDragKind(['Files'], { messageBinding: true, attach: true })).toBe('files')
    expect(acceptedDragKind(['Files'], { messageBinding: true, attach: false })).toBeNull()
  })

  test('unrelated drags (plain text, tab reorder) are not accepted', () => {
    expect(acceptedDragKind(['text/plain'], { messageBinding: true, attach: true })).toBeNull()
    expect(acceptedDragKind([], { messageBinding: true, attach: true })).toBeNull()
  })
})

describe('createDragDepth', () => {
  // The classic stuck-overlay bug: dragging across the composer's CHILDREN
  // fires interleaved enter/leave pairs; only the counter hitting 0 means the
  // pointer actually left the dropzone.
  test('child enter/leave storm never reports "left" early', () => {
    const d = createDragDepth()
    expect(d.enter()).toBe(1) // enter shell
    expect(d.enter()).toBe(2) // enter child (fires BEFORE parent leave)
    expect(d.leave()).toBe(1) // leave shell → still inside
    expect(d.enter()).toBe(2) // next child
    expect(d.leave()).toBe(1)
    expect(d.leave()).toBe(0) // leave last child → fully out
  })

  test('reset zeroes the depth (drop / cancel / global clear)', () => {
    const d = createDragDepth()
    d.enter()
    d.enter()
    d.enter()
    d.reset()
    expect(d.value).toBe(0)
  })

  test('never underflows: stray leaves after a reset stay at 0', () => {
    const d = createDragDepth()
    d.enter()
    d.reset() // e.g. window dragend cleared us while still "inside"
    expect(d.leave()).toBe(0)
    expect(d.leave()).toBe(0)
    // A fresh drag afterwards behaves normally.
    expect(d.enter()).toBe(1)
    expect(d.leave()).toBe(0)
  })
})
