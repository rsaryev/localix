import { describe, expect, test } from 'bun:test'
import { composerInsertMatchesSession } from '@/shared/lib/composerBus'
import { appendToDraft, isStageableAttachment, needsContextBoundSubmit } from './useComposerPrefill'

// Every insert names its chat. The defect pinned here: an insert that named none went to the
// FOCUSED composer, so a comment made in chat A's tab landed in chat B's draft when B was on screen.
describe('composer insert targeting', () => {
  test("an insert reaches the named chat's composer, and no other", () => {
    expect(composerInsertMatchesSession('s1', 's1')).toBe(true)
    expect(composerInsertMatchesSession('s1', 's2')).toBe(false)
  })

  test('a session-less composer declines an insert addressed to a new session', () => {
    expect(composerInsertMatchesSession('s1', null)).toBe(false)
    expect(composerInsertMatchesSession('s1', undefined)).toBe(false)
  })

  test('focus never decides: the rule has no input for it', () => {
    // A warm-hidden composer of the named chat still takes the insert; the focused composer of
    // another chat does not. Both follow from the two-argument rule above — this pins its arity,
    // so a focus fallback cannot creep back in as a third parameter.
    expect(composerInsertMatchesSession.length).toBe(2)
  })
})

describe('context-bound immediate submit ownership', () => {
  test('defers a bound action to PromptInput and keeps ordinary internal sends direct', () => {
    expect(
      needsContextBoundSubmit({
        sessionId: 's1',
        text: 'Summarize the attached chapter',
        submit: true,
        internal: true,
        bindings: [
          {
            kind: 'context',
            source: 'plugin',
            target: {
              kind: 'resource',
              token: '@resource:opaque:plugin-resource/book/0',
              label: 'Chapter 1',
              uri: 'opaque:plugin-resource/book/0',
            },
          },
        ],
      }),
    ).toBe(true)
    expect(
      needsContextBoundSubmit({
        sessionId: 's1',
        text: 'Run analysis',
        submit: true,
        internal: true,
      }),
    ).toBe(false)
  })
})

describe('where an insert lands in the draft', () => {
  test('an ordinary insert is its own paragraph', () => {
    expect(appendToDraft('look at this', 'quoted passage', {})).toBe(
      'look at this\n\nquoted passage',
    )
  })

  test('an inline insert continues the sentence', () => {
    // Clicking three colleagues in the roster builds an address line, not a column.
    let draft = appendToDraft('', '@localix ', { inline: true })
    draft = appendToDraft(draft, '@lead ', { inline: true })
    draft = appendToDraft(draft, '@product ', { inline: true })
    expect(draft).toBe('@localix @lead @product ')
  })

  test('the seam never doubles whitespace', () => {
    expect(appendToDraft('ask ', '@qa ', { inline: true })).toBe('ask @qa ')
    expect(appendToDraft('ask', '@qa ', { inline: true })).toBe('ask @qa ')
  })

  test('replace wins over both, and an empty draft is simply the text', () => {
    expect(appendToDraft('old', 'new', { replace: true })).toBe('new')
    expect(appendToDraft('   ', 'new', {})).toBe('new')
  })
})

describe('composer asset handoff', () => {
  test('re-stages a media-backed image without requiring inline base64 bytes', () => {
    expect(
      isStageableAttachment({
        kind: 'image',
        mediaType: 'image/png',
        mediaId: 'sha256.png',
        name: 'figure.png',
        size: 42,
      }),
    ).toBe(true)
  })
})
