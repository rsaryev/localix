/**
 * The gate that decides whether the composer's ambient tab links exist at all.
 *
 * Reported defect, twice: "the link only fires when I put focus in the input", and "only 1
 * link even though I have many tabs open". Both were here — the derivation was gated on
 * `isFocused`, and it only ever received one candidate. So these tests assert the two
 * things a user can actually observe: an UNFOCUSED but visible composer already carries its
 * links, and N candidates produce N refs.
 *
 * There is no `focused` parameter to pass, which is the structural half of the guard: focus
 * cannot be reintroduced as a condition without changing the signature this file pins.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { MessageBindingTargetKind, MessageContextBindingDraft } from '@localixai/plugin-sdk/ui'
import {
  ambientAutoRefs,
  ambientLinkDismissalKey,
  NO_AMBIENT_REFS,
  retainCurrentSelectionDismissals,
  type AmbientTabLink,
} from './ambientTabLinks'

const none: ReadonlySet<string> = new Set()
const noop = () => {}

const link = (tabId: string, token: string, label?: string): AmbientTabLink => {
  const kind: MessageBindingTargetKind = token.startsWith('@file:')
    ? 'file'
    : token.startsWith('@terminal:')
      ? 'terminal'
      : 'resource'
  const resolvedLabel = label ?? token
  const binding: MessageContextBindingDraft = {
    kind: 'context',
    source: 'active-tab',
    target: {
      kind,
      token,
      label: resolvedLabel,
      ...(kind === 'file' ? { attributes: { path: token.slice('@file:'.length) } } : {}),
    },
  }
  return { tabId, token, label: resolvedLabel, binding }
}

describe('visibility, not focus, is the gate', () => {
  test('a VISIBLE composer carries its links with no focus anywhere near it', () => {
    // The reported case: you are reading a file, the caret is not in the composer, and the
    // chips must already be there — that is the only way to see what a send would carry.
    const refs = ambientAutoRefs([link('t1', '@file:src/a.ts')], none, true, noop)
    expect(refs).toHaveLength(1)
    expect(refs[0]?.ref.raw).toBe('@file:src/a.ts')
  })

  test('a warm-HIDDEN composer derives nothing', () => {
    // Warm bodies stay mounted to keep their drafts; deriving there would preflight sizes
    // for a panel nobody is looking at.
    expect(ambientAutoRefs([link('t1', '@file:src/a.ts')], none, false, noop)).toEqual([])
  })

  test('the empty result is referentially stable', () => {
    // A fresh `[]` per render restarts the ref preflight debounce every render, and the
    // sizes never arrive. Both empty paths must return the shared constant.
    expect(ambientAutoRefs([], none, true, noop)).toBe(NO_AMBIENT_REFS)
    expect(ambientAutoRefs(undefined, none, true, noop)).toBe(NO_AMBIENT_REFS)
    expect(ambientAutoRefs([link('t1', '@file:a.ts')], none, false, noop)).toBe(NO_AMBIENT_REFS)
    // Every candidate filtered out is also empty — not a new array.
    expect(ambientAutoRefs([link('t1', '@file:a.ts')], new Set(['t1']), true, noop)).toBe(
      NO_AMBIENT_REFS,
    )
  })
})

describe('N candidates, N refs', () => {
  test('every linkable tab contributes, in the order given', () => {
    const refs = ambientAutoRefs(
      [link('t1', '@file:src/a.ts'), link('t2', '@file:src/b.ts'), link('t3', '@terminal:sh-1')],
      none,
      true,
      noop,
    )
    expect(refs.map((r) => r.ref.raw)).toEqual([
      '@file:src/a.ts',
      '@file:src/b.ts',
      '@terminal:sh-1',
    ])
  })

  test('a structured-only binding survives even though no text grammar parses its token', () => {
    const binding: MessageContextBindingDraft = {
      kind: 'context',
      source: 'active-tab',
      target: {
        kind: 'snippet',
        token: '@snippet:live chart',
        label: 'live chart',
        attributes: { content: '{"timeframe":"4h"}', language: 'json' },
      },
    }
    const refs = ambientAutoRefs(
      [{ tabId: 't1', token: binding.target.token, label: binding.target.label, binding }],
      none,
      true,
      noop,
    )
    expect(refs[0]?.ref).toMatchObject({
      kind: 'snippet',
      content: '{"timeframe":"4h"}',
      language: 'json',
    })
  })

  test("the tab's canonical label enriches the ref", () => {
    const refs = ambientAutoRefs([link('t1', '@file:src/a.ts', 'a.ts — worker')], none, true, noop)
    expect(refs[0]?.ref.label).toBe('a.ts — worker')
    // A canonical binding always has a label, even when the producer used the token as fallback.
    const bare = ambientAutoRefs([link('t1', '@file:src/a.ts')], none, true, noop)
    expect(bare[0]?.ref.label).toBe('@file:src/a.ts')
  })
})

describe('dismissal is per tab', () => {
  test('an unlinked tab drops out while its neighbours stay', () => {
    const refs = ambientAutoRefs(
      [link('t1', '@file:src/a.ts'), link('t2', '@file:src/b.ts')],
      new Set(['t1']),
      true,
      noop,
    )
    expect(refs.map((r) => r.ref.raw)).toEqual(['@file:src/b.ts'])
  })

  test('a dismissed selection re-arms only after the selection changes or clears', () => {
    const first = link('t1', '@snippet:a.ts L2')
    first.binding.target.kind = 'snippet'
    first.binding.target.attributes = {
      content: 'alpha',
      path: '/repo/a.ts',
      startLine: 2,
      startColumn: 1,
      endLine: 2,
      endColumn: 6,
      selection: true,
    }
    const dismissedKey = ambientLinkDismissalKey(first)
    const dismissed = new Set([dismissedKey])
    expect(ambientAutoRefs([first], dismissed, true, noop)).toBe(NO_AMBIENT_REFS)
    expect(retainCurrentSelectionDismissals(dismissed, [first])).toBe(dismissed)

    const changed = structuredClone(first)
    changed.binding.target.attributes!.content = 'beta'
    const rearmed = retainCurrentSelectionDismissals(dismissed, [changed])
    expect(rearmed.size).toBe(0)
    expect(ambientAutoRefs([changed], rearmed, true, noop)).toHaveLength(1)

    expect(retainCurrentSelectionDismissals(dismissed, []).size).toBe(0)
  })

  test("each ref's × dismisses ITS OWN tab", () => {
    // The bug this forbids: one shared closure, so × on any chip silences the first tab.
    const dismissed: string[] = []
    const refs = ambientAutoRefs(
      [link('t1', '@file:src/a.ts'), link('t2', '@file:src/b.ts'), link('t3', '@file:src/c.ts')],
      none,
      true,
      (tabId) => dismissed.push(tabId),
    )
    refs[2]?.dismiss()
    refs[0]?.dismiss()
    expect(dismissed).toEqual(['t3', 't1'])
  })

  test("two tabs of the SAME file are both offered here — dedup is the ref layer's job", () => {
    // Deliberate division of labour: this module knows tabs, `includeAutoRefs` knows refs and
    // collapses same-key candidates. Filtering here would lose the second tab's dismissal.
    const refs = ambientAutoRefs(
      [link('t1', '@file:src/a.ts'), link('t2', '@file:src/a.ts')],
      none,
      true,
      noop,
    )
    expect(refs).toHaveLength(2)
  })
})

/**
 * The other half of the guard: this module can only be as correct as its wiring, and the
 * wiring is one argument in the composer's context-refs hook (`useComposerContextRefs.ts`).
 * Source-scanning, following the three rules `ChatSurface.test.ts` documents — assert the CALL
 * and its argument, never a bare identifier; comments are stripped first, because the prose
 * above the call names the very identifier this forbids and would satisfy a naive `includes`.
 */
describe('PromptInput wires visibility, not focus', () => {
  const stripComments = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const composer = stripComments(
    readFileSync(resolve(import.meta.dir, './PromptInput.tsx'), 'utf8'),
  )

  test('the composer hands the hook the tab LIST, and no focus signal', () => {
    const at = composer.indexOf('useComposerContextRefs(')
    expect(at).toBeGreaterThan(-1)
    const args = composer.slice(at, composer.indexOf(')', at))
    expect(args).toContain('activeTabLinks')
    expect(args).not.toContain('isFocused')
  })

  const source = readFileSync(resolve(import.meta.dir, './useComposerContextRefs.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

  const callArgs = (fn: string): string => {
    const at = source.indexOf(`${fn}(`)
    expect(at).toBeGreaterThan(-1)
    return source.slice(at + fn.length + 1, source.indexOf(')', at))
  }

  test('the ambient derivation is gated on the visibility signal', () => {
    expect(source).toContain('useWorkItemVisible()')
    const args = callArgs('ambientAutoRefs')
    expect(args).toContain('visible')
    // The reported defect, forbidden structurally.
    expect(args).not.toContain('isFocused')
  })

  test('the ref preflight follows the SAME signal — one gate, not two', () => {
    // Two gates would drift: chips visible with no sizes, or sizes fetched for a hidden panel.
    const args = callArgs('useContextRefs')
    expect(args).toContain('visible')
    expect(args).not.toContain('isFocused')
  })

  test('the composer receives the LIST of tab candidates', () => {
    // `activeTabLink` (singular) is what limited the agent to one open tab.
    expect(source).toContain('activeTabLinks')
    expect(source).not.toMatch(/\bactiveTabLink\b(?!s)/)
  })
})
