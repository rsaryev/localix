import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { PROVIDER_ADAPTERS } from './registry'
import { linkKeyOf, parseLinkKey } from '../../shared/identity'

/**
 * `shared/identity.ts` is the only place a session key may be built. The README states it as a rule and
 * `linkKeyOf` percent-encodes both halves so "an exotic id can never forge a different provider's key";
 * a hand-built template literal skips that while producing an identical string for ordinary ids, which
 * is why the divergence sat in the GitHub Copilot adapter unnoticed.
 *
 * Source-reading, following `apps/api/src/lib/validator.test.ts`: the rule is about how code is
 * WRITTEN, and no runtime assertion can see a template literal that happens to agree today.
 */
const DIR = import.meta.dir
const HAND_BUILT = /key:\s*`\$\{[^}]*\}:/

function adapterSources(): { file: string; text: string }[] {
  return readdirSync(DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => ({ file: name, text: readFileSync(join(DIR, name), 'utf8') }))
}

describe('only shared/identity.ts builds a session key', () => {
  test('no adapter assembles one from a template literal', () => {
    const offenders = adapterSources()
      .filter(({ text }) => HAND_BUILT.test(text))
      .map(({ file }) => file)

    // If this fails: call `linkKeyOf({ provider, nativeSessionId })` instead. The string is the same
    // for ordinary ids and different for exactly the ones the encoding exists to survive.
    expect(offenders).toEqual([])
  })

  test('positive control: the reader finds sources, and the pattern catches a real offender', () => {
    // Without this, a regex that matched nothing would pass forever — the same silence it guards.
    const sources = adapterSources()
    expect(sources.length).toBeGreaterThan(5)
    expect(sources.some(({ file }) => file === 'github-copilot.ts')).toBe(true)
    expect(HAND_BUILT.test('    key: `${ID}:${ref.nativeSessionId}`,')).toBe(true)
    expect(HAND_BUILT.test('    key: linkKeyOf({ provider: ID, nativeSessionId: id }),')).toBe(
      false,
    )
  })

  test('every adapter that keys a session imports the encoder', () => {
    const named = new Set(PROVIDER_ADAPTERS.map((adapter) => adapter.id))
    const missing = adapterSources()
      .filter(({ file, text }) => {
        const id = file.replace(/\.ts$/, '')
        return named.has(id) && text.includes('key:') && !text.includes('linkKeyOf')
      })
      .map(({ file }) => file)

    expect(missing).toEqual([])
  })
})

describe('the encoding is what makes a key survive an exotic id', () => {
  test('a hand-built key loses an id containing a percent escape; an encoded one does not', () => {
    // Measured: a Copilot session directory named `a%41b` round-trips to `aAb` through a hand-built
    // key — a different session, so the row becomes unopenable — and back to itself through `linkKeyOf`.
    const raw = 'a%41b'
    const hand = `github-copilot:${raw}`
    const encoded = linkKeyOf({ provider: 'github-copilot', nativeSessionId: raw })

    expect(parseLinkKey(hand)?.nativeSessionId).toBe('aAb')
    expect(parseLinkKey(encoded)?.nativeSessionId).toBe(raw)
  })
})
