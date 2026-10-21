import { describe, expect, test } from 'bun:test'
import {
  MAX_API_VERSION,
  MIN_API_VERSION,
  compareApiVersions,
  negotiateApiVersion,
} from './api-version'

describe('compareApiVersions', () => {
  test('per-component integers, not lexical', () => {
    // The trap: lexically "1.9" sorts ABOVE "1.10", so a lexical compare would refuse to
    // downgrade for a 1.9 daemon and then send it requests it cannot answer.
    expect(compareApiVersions('1.9', '1.10')).toBe(-1)
    expect(compareApiVersions('1.10', '1.9')).toBe(1)
  })

  test('equality, including trailing zero components', () => {
    expect(compareApiVersions('1.44', '1.44')).toBe(0)
    expect(compareApiVersions('1.44', '1.44.0')).toBe(0)
  })

  test('ordinary ordering', () => {
    expect(compareApiVersions('1.40', '1.44')).toBe(-1)
    expect(compareApiVersions('1.55', '1.44')).toBe(1)
    expect(compareApiVersions('2.0', '1.99')).toBe(1)
  })

  test('junk components count as zero rather than producing NaN comparisons', () => {
    expect(compareApiVersions('1.x', '1.0')).toBe(0)
    expect(compareApiVersions('', '1.0')).toBe(-1)
  })
})

describe('negotiateApiVersion', () => {
  test('a newer daemon is met at OUR maximum', () => {
    // E.g. a daemon serving 1.55 while we speak 1.44. Every newer daemon understands it.
    expect(negotiateApiVersion({ apiVersion: '1.55', minApiVersion: '1.40', os: 'linux' })).toEqual(
      {
        version: MAX_API_VERSION,
        oneShotStats: true,
        windows: false,
      },
    )
  })

  test('an older daemon is met at ITS version — the downgrade moby performs', () => {
    expect(negotiateApiVersion({ apiVersion: '1.41', minApiVersion: '1.12' })).toMatchObject({
      version: '1.41',
      oneShotStats: true,
    })
  })

  test('1.40 negotiates fine but loses one-shot stats', () => {
    // Verified against a real daemon: at v1.40 `one-shot` is IGNORED and the two-cycle wait
    // happens anyway. Claiming the capability would mean expecting a 7ms answer and blocking
    // for 1.2s on every stats poll.
    expect(negotiateApiVersion({ apiVersion: '1.40', minApiVersion: '1.12' })).toMatchObject({
      version: MIN_API_VERSION,
      oneShotStats: false,
    })
  })

  test('a daemon below our floor is null — meaning "use the CLI", not "fail"', () => {
    // The CLI still supports these; refusing outright would take the workbench down on a host
    // that works perfectly well.
    expect(negotiateApiVersion({ apiVersion: '1.24' })).toBeNull()
    expect(negotiateApiVersion({ apiVersion: '1.39', minApiVersion: '1.12' })).toBeNull()
  })

  test('a daemon whose own floor is above everything we speak is null too', () => {
    // What a far-future daemon that dropped old versions looks like: it would 400 our best offer.
    expect(negotiateApiVersion({ apiVersion: '2.10', minApiVersion: '2.0' })).toBeNull()
  })

  test("the daemon's own floor raises our choice when it sits between us", () => {
    // Daemon serves 1.42 max but refuses below 1.41 — we must not send 1.40.
    expect(negotiateApiVersion({ apiVersion: '1.42', minApiVersion: '1.41' })).toMatchObject({
      version: '1.42',
    })
  })

  test('a missing or unreadable version is null rather than a guess', () => {
    expect(negotiateApiVersion({})).toBeNull()
    expect(negotiateApiVersion({ apiVersion: 42 })).toBeNull()
    expect(negotiateApiVersion({ apiVersion: '   ' })).toBeNull()
  })

  test('a Windows daemon is flagged, because its stats formulas differ', () => {
    expect(negotiateApiVersion({ apiVersion: '1.44', os: 'windows' })).toMatchObject({
      windows: true,
    })
    expect(negotiateApiVersion({ apiVersion: '1.44', os: 'Windows' })).toMatchObject({
      windows: true,
    })
    expect(negotiateApiVersion({ apiVersion: '1.44', os: 'linux' })).toMatchObject({
      windows: false,
    })
  })
})
