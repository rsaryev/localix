/**
 * The pointer prose is BEHAVIOR, and it is the kind of behavior no ordinary test covers:
 * it reads like copy, it lives in a template literal nothing type-checks, and a reword is
 * a one-word diff. But two things downstream read it back as a STRING, and both fail
 * silently when it drifts:
 *
 *   - the RATCHET (`!text.includes(ELISION_MARKER)`) — what makes compression idempotent;
 *   - `collectElidedToolCallIds` — how a host answers "does the model still have the full
 *     output of that call?", which it feeds back as the elision ratchet.
 *
 * So the contract is checked here rather than trusted: every pointer any layer emits must
 * carry the marker, the stale pointer must never advertise a replay of bytes that are
 * gone, and the two layers must not drift apart.
 */
import { describe, expect, test } from 'bun:test'
import { applyPlan } from './apply'
import { CRUSH_MARKER } from './crushers'
import { ELISION_MARKER } from './op-menu'
import { elidedPointer, readPointer } from './pointers'
import {
  collectElidedToolCallIds,
  isCompressedContent,
  MIDDLE_TRUNCATE_MARKER,
  pruneWireMessages,
} from './prune-wire'
import { namedTool, msg } from './_test-helpers'
import type { ChatMessage } from '../chat'
import type { Message, ToolCall } from '../types'

const FATES = ['live', 'stale', 'refreshed'] as const

const toolMessage = (content: string): Message =>
  ({
    role: 'tool',
    results: [{ toolCallId: 'tc1', toolName: 'read', content }],
  }) as unknown as Message

describe('every pointer carries the marker that makes it recognizable', () => {
  test('a read pointer, whatever the fate, is detected as elided', () => {
    for (const fate of FATES) {
      const text = readPointer(fate, 1234, 'tc1')
      expect(text).toContain(ELISION_MARKER)
      // …and the detector that actually gates the ratchet + the read-stub agrees.
      expect(collectElidedToolCallIds([toolMessage(text)])).toEqual(['tc1'])
    }
  })

  test('an arg pointer is detected too — with a locator and without', () => {
    for (const text of [elidedPointer('content', 900, 'tc1'), elidedPointer('content', 900)]) {
      expect(text).toContain(ELISION_MARKER)
    }
  })

  test('an intact result is NOT reported as elided (the detector is not vacuous)', () => {
    expect(collectElidedToolCallIds([toolMessage('the real file content')])).toEqual([])
  })
})

/**
 * "Is this already compressed?" is ONE question with three possible marks on it, and the
 * ratchet + the intact-or-not question both hang off it. Callers used to spell out the
 * three-way OR chain by hand, which is how a fourth compression layer gets added to some
 * of them and not the others.
 */
describe('every compression layer leaves a mark the next one can see', () => {
  test('each of the three markers is recognized inside a real placeholder', () => {
    // Carried the way every emitter actually writes them: inside ONE bracketed
    // placeholder. `prefix <marker> suffix` used to pass here, which is precisely the
    // shape DATA takes — see the forgery test below.
    for (const marker of [ELISION_MARKER, MIDDLE_TRUNCATE_MARKER, CRUSH_MARKER]) {
      expect(isCompressedContent(`head\n[${marker} — 12 chars]\ntail`)).toBe(true)
    }
  })

  test('DATA that merely mentions a marker does not forge the signal', () => {
    // The markers are ordinary English and sit verbatim in our own source, so an agent
    // reading or grepping `op-menu.ts` used to hand itself "already compressed". That
    // result then skipped every bound AND latched its tool_call_id into the session's
    // elided set, flipping `read` from a stub back to the whole file on every re-read.
    expect(isCompressedContent(`export const ELISION_MARKER = '${ELISION_MARKER}'`)).toBe(false)
    expect(isCompressedContent(`54:  const CRUSH_MARKER = '${CRUSH_MARKER}'`)).toBe(false)
    expect(isCompressedContent(`the middle was ${MIDDLE_TRUNCATE_MARKER} by the pruner`)).toBe(
      false,
    )
    // A closed bracket earlier on the line must not anchor a later mention.
    expect(isCompressedContent(`[note] output is ${ELISION_MARKER} when large`)).toBe(false)
  })

  test('untouched content is not', () => {
    expect(isCompressedContent('export function foo() { return 1 }')).toBe(false)
  })
})

describe('the recovery a pointer advertises must be one that works', () => {
  test('a LIVE read offers the cheap one-turn replay', () => {
    expect(readPointer('live', 10, 'tc1')).toContain(
      'tool_output(action="get", tool_call_id="tc1")',
    )
  })

  test('a STALE read never offers a replay — the bytes no longer exist on disk', () => {
    const text = readPointer('stale', 10, 'tc1')
    expect(text).not.toContain('tool_output')
    expect(text).toContain('read the file again')
  })

  test('a REFRESHED read points at the newer read, not at a replay or a re-read', () => {
    const text = readPointer('refreshed', 10, 'tc1')
    expect(text).not.toContain('tool_output')
    expect(text).toContain('a NEWER read of the same file appears later')
  })

  test('with no tool_call_id there is no handle to offer, so it falls back to a re-read', () => {
    const text = elidedPointer('output', 10)
    expect(text).not.toContain('tool_output')
    expect(text).toContain('re-read the file/source if needed')
  })

  test('a disabled recovery tool is never advertised even when a tool_call_id exists', () => {
    const read = readPointer('live', 10, 'tc1', 'source text', false)
    const mutation = elidedPointer('patch', 10, 'tc2', 'patch text', false)
    expect(read).not.toContain('tool_output')
    expect(mutation).not.toContain('tool_output')
    expect(read).toContain('re-read the file/source if needed')
    expect(mutation).toContain('re-read the file/source if needed')
  })
})

/**
 * Pinned byte-exact. These strings were duplicated verbatim across the two compression
 * layers (turn-start VBC and the per-request wire prune); one owner now emits both. A
 * reword shows up HERE, as a diff carrying the old words — not as a model that was quietly
 * told to replay bytes that are gone.
 */
describe('the exact words, pinned', () => {
  test('live', () => {
    expect(readPointer('live', 42, 'tc1')).toBe(
      '[output elided to save context — 42 chars; recover the exact bytes via tool_output(action="get", tool_call_id="tc1") — a cheap one-turn replay — or re-read the file only if it may have changed since]',
    )
  })

  test('stale', () => {
    expect(readPointer('stale', 42, 'tc1')).toBe(
      '[output elided to save context — 42 chars, and the file has CHANGED since this read; do NOT replay it — read the file again if you need its current content]',
    )
  })

  test('refreshed', () => {
    expect(readPointer('refreshed', 42, 'tc1')).toBe(
      '[output elided to save context — 42 chars; a NEWER read of the same file appears later in this conversation — use that]',
    )
  })

  test('a heavy mutate arg, by field name', () => {
    expect(elidedPointer('content', 42, 'tc1')).toBe(
      '[content elided to save context — 42 chars; recover the exact bytes via tool_output(action="get", tool_call_id="tc1") — a cheap one-turn replay — or re-read the file only if it may have changed since]',
    )
    expect(elidedPointer('edits', 42)).toBe(
      '[edits elided to save context — 42 chars; re-read the file/source if needed]',
    )
  })
})

/**
 * The pin above only proves the OWNER's words. It cannot see an emitter that never asks
 * the owner — and for the heavy mutate ARG, one of the two layers did exactly that: VBC
 * (`apply.ts`) re-typed its own variant ("written to disk; … or re-read the file if it
 * changed") while the wire prune emitted the owner's. Same elided write, same facts known,
 * two different instructions to the model — decided by which layer happened to fire.
 *
 * It is not a case where one layer knows more: `heavyMutateInputs` (VBC) and the
 * `failedToolCallIds` guard (wire) both refuse a mutation that did not reach disk, and
 * NEITHER computes a fate for a mutate arg — so neither can claim the file is unchanged.
 *
 * So the divergence is driven out through the REAL layers, not through the owner both
 * would have to call for the test to pass.
 */
describe('both layers emit the SAME mutate-arg pointer', () => {
  const CONTENT = 'x'.repeat(900)
  const argOf = (tc: ToolCall) => (tc.arguments as Record<string, unknown>).content

  /** VBC (turn-start, item model): elide a completed `write`'s args. */
  const viaApplyPlan = (toolCallId: string): unknown => {
    const item = namedTool(
      'write',
      { path: '/a.ts', content: CONTENT },
      { resultText: 'Wrote 900 bytes' },
    )
    const withId = { ...item, id: toolCallId, toolCallId }
    const messages: ChatMessage[] = [msg({ items: [withId] })]
    const out = applyPlan(messages, {
      assignment: [{ index: 0, op: { kind: 'elide', cost: 0, retention: 0.95, lossless: true } }],
      estTokensBefore: 0,
      estTokensAfter: 0,
      budget: 0,
    })
    return (out[0].items![0] as { input: Record<string, unknown> }).input.content
  }

  /** The per-request wire prune: elide the same call's args on the wire. */
  const viaPruneWire = (toolCallId: string): unknown => {
    const call: ToolCall = {
      type: 'tool_call',
      id: toolCallId,
      name: 'write',
      arguments: { path: '/a.ts', content: CONTENT },
    } as ToolCall
    const wire = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: [call] },
      { role: 'tool', results: [{ toolCallId, toolName: 'write', content: 'Wrote 900 bytes' }] },
      ...Array.from({ length: 8 }, () => ({ role: 'user', content: 'next' })),
    ] as unknown as Message[]
    const out = pruneWireMessages(wire, {
      keepRecentTokens: 1,
      minKeepRecent: 1,
      boundaryQuantum: 1,
    })
    const assistant = out.find((m) => m.role === 'assistant')!
    return argOf(assistant.content[0] as ToolCall)
  }

  test('byte-identical prose — a reword in one layer can no longer diverge from the other', () => {
    const vbc = viaApplyPlan('tc-same')
    const wire = viaPruneWire('tc-same')
    expect(vbc).toContain(ELISION_MARKER) // both actually elided (the test is not vacuous)
    expect(wire).toContain(ELISION_MARKER)
    expect(vbc).toBe(wire)
    expect(vbc).toBe(elidedPointer('content', CONTENT.length, 'tc-same')) // …and it is the OWNER's text
  })

  /**
   * The handle a pointer advertises must RESOLVE. `apply.ts` guards `if (!id)` when it
   * writes a bare pointer placeholder — so an empty id is a state this very file already
   * believes in — but its mutate-arg branch interpolated the id unconditionally, emitting
   * `tool_output(action="get", tool_call_id="")`: a call the tool cannot find, costing the model a
   * turn on a not_found before it falls back to the re-read it should have been told to do.
   */
  test('with no tool_call_id, VBC offers no handle rather than an unresolvable one', () => {
    const text = viaApplyPlan('')
    expect(text).not.toContain('tool_output')
    expect(text).not.toContain('tool_call_id=""')
    expect(text).toBe(elidedPointer('content', CONTENT.length))
  })
})
