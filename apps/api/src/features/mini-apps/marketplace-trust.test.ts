import { describe, expect, test } from 'bun:test'

import { judgeMarketplace } from './marketplace-trust'

const [A, B, C] = ['A', 'B', 'C'].map((letter) => `${letter.repeat(42)}A=`)
const MONDAY = '2026-10-26T09:00:00.000Z'
const FRIDAY = '2026-10-30T09:00:00.000Z'

describe('a marketplace the person added', () => {
  test('its first signed read is trusted, and the keys it names for next time are kept', () => {
    expect(
      judgeMarketplace({
        signatures: { keys: [A!] },
        published: MONDAY,
        signingKeys: [A!],
        kept: undefined,
        firstUse: true,
      }),
    ).toEqual({ state: 'signed', keep: { keys: [A!], published: MONDAY } })
  })

  test('signed by a kept key, it stays signed; the release date moves on', () => {
    expect(
      judgeMarketplace({
        signatures: { keys: [A!] },
        published: FRIDAY,
        signingKeys: [A!],
        kept: { keys: [A!], published: MONDAY },
        firstUse: true,
      }),
    ).toEqual({ state: 'signed', keep: { keys: [A!], published: FRIDAY } })
  })

  test('a release signed by the old key that names a new one moves to the new key', () => {
    const rotated = judgeMarketplace({
      signatures: { keys: [A!, B!] },
      published: FRIDAY,
      signingKeys: [B!],
      kept: { keys: [A!], published: MONDAY },
      firstUse: true,
    })
    expect(rotated).toEqual({ state: 'signed', keep: { keys: [B!], published: FRIDAY } })
    expect(
      judgeMarketplace({
        signatures: { keys: [B!] },
        published: FRIDAY,
        signingKeys: [B!],
        kept: rotated.keep,
        firstUse: true,
      }).state,
    ).toBe('signed')
  })

  test('signed by a key never kept, it has changed, and nothing it says is kept', () => {
    expect(
      judgeMarketplace({
        signatures: { keys: [C!] },
        published: FRIDAY,
        signingKeys: [C!],
        kept: { keys: [A!], published: MONDAY },
        firstUse: true,
      }),
    ).toEqual({ state: 'mismatch' })
    expect(
      judgeMarketplace({
        signatures: null,
        published: FRIDAY,
        kept: { keys: [A!], published: MONDAY },
        firstUse: true,
      }),
    ).toEqual({ state: 'mismatch' })
  })

  test('never signed, it is not signed, and its release date is still kept', () => {
    expect(
      judgeMarketplace({ signatures: null, published: MONDAY, kept: undefined, firstUse: true }),
    ).toEqual({ state: 'unsigned', keep: { keys: [], published: MONDAY } })
    expect(
      judgeMarketplace({
        signatures: null,
        published: MONDAY,
        kept: { keys: [], published: MONDAY },
        firstUse: true,
      }),
    ).toEqual({ state: 'unsigned' })
  })
})

describe('a release older than one already read', () => {
  test('is refused: an old signed release cannot be served again', () => {
    expect(
      judgeMarketplace({
        signatures: { keys: [A!] },
        published: MONDAY,
        signingKeys: [A!],
        kept: { keys: [A!], published: FRIDAY },
        firstUse: true,
      }),
    ).toEqual({
      state: 'signed',
      refused: `an older release than the one already read (${FRIDAY})`,
    })
  })

  test('so is one that stops saying when it was made', () => {
    expect(
      judgeMarketplace({
        signatures: { keys: [A!] },
        signingKeys: [A!],
        kept: { keys: [A!], published: FRIDAY },
        firstUse: true,
      }).refused,
    ).toBe(`an older release than the one already read (${FRIDAY})`)
  })

  test('the same release read again is not older', () => {
    expect(
      judgeMarketplace({
        signatures: { keys: [A!] },
        published: '2026-10-30T12:00:00+03:00',
        signingKeys: [A!],
        kept: { keys: [A!], published: FRIDAY },
        firstUse: true,
      }),
    ).toEqual({ state: 'signed' })
  })
})

describe('a marketplace Localix ships the keys of', () => {
  test('is signed only by those keys: a first read signed by another is not trusted', () => {
    expect(
      judgeMarketplace({
        signatures: { keys: [C!] },
        published: MONDAY,
        signingKeys: [C!],
        kept: undefined,
        pinned: [A!],
        firstUse: false,
      }),
    ).toEqual({ state: 'mismatch' })
  })

  test('rotates as any other, the keys it moved to remembered with the ones Localix shipped', () => {
    expect(
      judgeMarketplace({
        signatures: { keys: [A!, B!] },
        published: FRIDAY,
        signingKeys: [B!],
        kept: undefined,
        pinned: [A!],
        firstUse: false,
      }),
    ).toEqual({ state: 'signed', keep: { keys: [B!], published: FRIDAY, root: [A!] } })
  })

  test('a Localix that ships other keys starts again from them: a leaked key is dropped', () => {
    expect(
      judgeMarketplace({
        signatures: { keys: [B!] },
        published: FRIDAY,
        signingKeys: [B!],
        kept: { keys: [B!], published: MONDAY, root: [A!] },
        pinned: [C!],
        firstUse: false,
      }),
    ).toEqual({ state: 'mismatch' })
  })
})
