import { describe, expect, test } from 'bun:test'
import { avatarHash, avatarHue, avatarInitials, avatarSeed } from './avatar-seed'

describe('avatarHash', () => {
  test('is the published FNV-1a vector, not merely self-consistent', () => {
    // Pinned against the published FNV-1a vectors. A hash that only agrees with itself would
    // pass a determinism test while silently drifting the whole roster's colours on a rewrite.
    expect(avatarHash('')).toBe(0x811c9dc5)
    expect(avatarHash('a')).toBe(0xe40c292c)
    expect(avatarHash('foobar')).toBe(0xbf9cf968)
  })

  test('stays an unsigned 32-bit number however long the input', () => {
    const hash = avatarHash('x'.repeat(1000))
    expect(Number.isInteger(hash)).toBe(true)
    expect(hash).toBeGreaterThanOrEqual(0)
    expect(hash).toBeLessThan(2 ** 32)
  })
})

describe('avatarInitials', () => {
  test.each([
    ['localix', 'LO'],
    ['Code Reviewer', 'CR'],
    ['code-reviewer', 'CR'],
    ['code_reviewer', 'CR'],
    ['docs/writer', 'DW'],
    ['  spaced   out  ', 'SO'],
  ])('%s reads as %s', (name, expected) => {
    expect(avatarInitials(name)).toBe(expected)
  })

  test('a nameless record still gets a tile', () => {
    expect(avatarInitials('   ')).toBe('?')
  })

  test('an astral character counts as one letter', () => {
    // `slice(0, 2)` on the string would cut the surrogate pair in half and render a replacement
    // glyph next to the second letter.
    expect(avatarInitials('🚀ship')).toBe('🚀S')
  })
})

describe('avatarHue', () => {
  test('is FROZEN — these handles keep these colours', () => {
    // An agent's colour is how it is recognised, so it must not move: not on a rebuild, not
    // on another machine, not because the derivation was tuned. This vector is the contract.
    // Changing it repaints every roster and every transcript, so a failure here is a
    // deliberate decision to make, never a number to update to make the suite green.
    expect({
      localix: avatarHue('localix'),
      implementer: avatarHue('implementer'),
      verifier: avatarHue('verifier'),
      researcher: avatarHue('researcher'),
      reviewer: avatarHue('reviewer'),
    }).toEqual({
      localix: 147,
      implementer: 294,
      verifier: 215,
      researcher: 129,
      reviewer: 228,
    })
  })

  test('never lands in the olive band', () => {
    // 55–115° at the tile's lightness is olive in dark and mustard in light — the one arc
    // where a generated colour looks like a mistake rather than a choice.
    for (let index = 0; index < 500; index += 1) {
      const hue = avatarHue(`agent-${index}`)
      expect(hue < 55 || hue >= 115).toBe(true)
    }
  })

  test('spreads across the arcs it does use', () => {
    // The reduction is `% 360` then squeezed, not `% 300`: FNV-1a is uniform mod 360 and
    // lumpy mod 300, and the short version put eight of ten real handles in the same red.
    const buckets = Array.from({ length: 10 }, () => 0)
    for (let index = 0; index < 2000; index += 1) {
      const hue = avatarHue(`agent-${index}`)
      buckets[Math.floor((hue < 55 ? hue : hue - 60) / 30)]! += 1
    }
    for (const count of buckets) expect(count).toBeGreaterThan(100)
  })
})

describe('avatarSeed', () => {
  test('the hue comes from the handle, so a rename keeps the colour', () => {
    const before = avatarSeed('reviewer', 'Code Reviewer')
    const after = avatarSeed('reviewer', 'Diff Inspector')
    expect(after.hue).toBe(before.hue)
    expect(after.initials).not.toBe(before.initials)
  })

  test('an unlabelled agent letters from its handle', () => {
    expect(avatarSeed('reviewer').initials).toBe('RE')
    expect(avatarSeed('reviewer', '  ').initials).toBe('RE')
  })

  test('hues land on the wheel and different handles land apart', () => {
    const handles = ['reviewer', 'writer', 'planner', 'localix', 'tester']
    for (const handle of handles) {
      expect(avatarHue(handle)).toBeGreaterThanOrEqual(0)
      expect(avatarHue(handle)).toBeLessThan(360)
    }
    expect(new Set(handles.map(avatarHue)).size).toBe(handles.length)
  })
})
