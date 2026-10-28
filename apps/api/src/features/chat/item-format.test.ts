import { describe, expect, test } from 'bun:test'
import type { AgentItem } from '@localixai/agent/agents'
import {
  countEditChanges,
  countPatchChanges,
  countTextLines,
  itemActionVerb,
  isTranscriptItemHidden,
} from './item-format'

const item = (props: Record<string, unknown>): AgentItem => props as unknown as AgentItem

describe('descriptor-owned transcript visibility', () => {
  test('unknown tool names can declare suppression; known names are not special', () => {
    expect(
      isTranscriptItemHidden(
        item({ type: 'tool_call', name: 'conversation_control', status: 'completed' }),
      ),
    ).toBe(false)
    expect(
      isTranscriptItemHidden(
        item({
          type: 'tool_call',
          name: 'extension_protocol',
          status: 'completed',
          presentation: { transcript: 'hidden' },
        }),
      ),
    ).toBe(true)
  })

  test.each(['pending', 'running', 'completed'] as const)(
    'suppresses declared %s protocol traffic',
    (status) => {
      expect(
        isTranscriptItemHidden(
          item({ type: 'tool_call', status, presentation: { transcript: 'hidden' } }),
        ),
      ).toBe(true)
    },
  )

  test.each([
    { status: 'failed' },
    { status: 'aborted' },
    { status: 'completed', error: { code: 'UNAVAILABLE', message: 'Unavailable' } },
    { status: 'completed', errorText: 'Unavailable' },
  ])('never suppresses errors or interrupted activity: %j', (over) => {
    expect(
      isTranscriptItemHidden(
        item({ type: 'tool_call', presentation: { transcript: 'hidden' }, ...over }),
      ),
    ).toBe(false)
  })

  test.each(['tool', 'content', undefined])('keeps %s presentation visible', (transcript) => {
    expect(
      isTranscriptItemHidden(
        item({ type: 'tool_call', status: 'completed', presentation: { transcript } }),
      ),
    ).toBe(false)
  })
})

describe('itemActionVerb', () => {
  test('command → Running, narrative → Working', () => {
    expect(itemActionVerb(item({ type: 'command' }))).toBe('Running')
    expect(itemActionVerb(item({ type: 'text' }))).toBe('Working')
    expect(itemActionVerb(item({ type: 'reasoning' }))).toBe('Working')
  })

  test('mcp_call names the tool', () => {
    expect(itemActionVerb(item({ type: 'mcp_call', tool: 'github/search' }))).toBe(
      'Calling github/search',
    )
  })

  test('file_change uses the resolver, else falls back to Editing', () => {
    expect(itemActionVerb(item({ type: 'file_change', name: 'Write' }))).toBe('Editing')
    expect(itemActionVerb(item({ type: 'file_change', name: 'Write' }), () => 'Writing')).toBe(
      'Writing',
    )
  })

  test('tool_call: resolver verb wins, then activeVerb, then Running', () => {
    // A resolver verb other than the generic "Running" is preferred.
    expect(itemActionVerb(item({ type: 'tool_call', name: 'Search' }), () => 'Searching')).toBe(
      'Searching',
    )
    // A generic "Running" from the resolver yields to the item's own activeVerb.
    expect(
      itemActionVerb(
        item({ type: 'tool_call', name: 'x', activeVerb: 'Thinking' }),
        () => 'Running',
      ),
    ).toBe('Thinking')
    // No resolver + no activeVerb → Running.
    expect(itemActionVerb(item({ type: 'tool_call', name: 'x' }))).toBe('Running')
  })
})

/**
 * The change-stat family is fed the RAW, possibly PARTIAL tool arguments — the card
 * renders a live count while the model is still emitting the JSON. So the contract
 * under test is mostly about DEGENERATE input: every absent / wrong-typed / half-built
 * shape must read as 0, never throw and never over-count. These cases are exactly what
 * the two client copies each handled slightly differently before this leaf owned them.
 */
describe('countTextLines', () => {
  test('counts lines; a trailing newline opens a new (empty) line', () => {
    expect(countTextLines('a')).toBe(1)
    expect(countTextLines('a\nb')).toBe(2)
    expect(countTextLines('a\n')).toBe(2)
  })

  test('every degenerate input is 0, not a throw', () => {
    expect(countTextLines('')).toBe(0)
    expect(countTextLines(undefined)).toBe(0)
    expect(countTextLines(null)).toBe(0)
    expect(countTextLines(42)).toBe(0)
    expect(countTextLines({})).toBe(0)
  })
})

describe('countPatchChanges', () => {
  test('counts +/- body lines', () => {
    expect(countPatchChanges('+a\n+b\n-c\n ctx')).toEqual({ added: 2, removed: 1 })
  })

  test('the +++/--- file headers are not changes', () => {
    expect(countPatchChanges('--- a/x.ts\n+++ b/x.ts\n+a\n-b')).toEqual({ added: 1, removed: 1 })
  })

  test('every degenerate input is {0,0}', () => {
    expect(countPatchChanges('')).toEqual({ added: 0, removed: 0 })
    expect(countPatchChanges(undefined)).toEqual({ added: 0, removed: 0 })
    expect(countPatchChanges(null)).toEqual({ added: 0, removed: 0 })
    expect(countPatchChanges(['+a'])).toEqual({ added: 0, removed: 0 })
  })
})

describe('countEditChanges', () => {
  test('sums each edit: new_string adds lines, old_string removes them', () => {
    expect(
      countEditChanges([
        { old_string: 'a', new_string: 'x\ny' },
        { old_string: 'b\nc', new_string: 'z' },
      ]),
    ).toEqual({ added: 3, removed: 3 })
  })

  test('a MID-STREAM partial counts what it has and skips what it does not', () => {
    // The argument JSON is still arriving: a half-built object, an absent field, a
    // non-object element. None of these may throw, and none may over-count.
    expect(
      countEditChanges([{ new_string: 'x' }, null, 'not-an-object', { old_string: '' }]),
    ).toEqual({ added: 1, removed: 0 })
  })

  test('every degenerate input is {0,0}', () => {
    expect(countEditChanges(undefined)).toEqual({ added: 0, removed: 0 })
    expect(countEditChanges(null)).toEqual({ added: 0, removed: 0 })
    expect(countEditChanges([])).toEqual({ added: 0, removed: 0 })
    expect(countEditChanges({ old_string: 'a' })).toEqual({ added: 0, removed: 0 }) // an object, not an array
  })

  test('the returned stats are not a shared object — a caller may mutate its copy', () => {
    const a = countEditChanges(undefined)
    a.added = 99
    expect(countEditChanges(undefined)).toEqual({ added: 0, removed: 0 })
  })
})
