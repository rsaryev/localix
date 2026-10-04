import { describe, expect, it } from 'bun:test'

import { scoreSlashMatch, SlashMatchTier } from './slash-match'

const cmd = { name: '/commit', description: 'Stage and commit changes' }

describe('scoreSlashMatch tiers', () => {
  it('ranks exact > prefix > substring > subsequence', () => {
    expect(scoreSlashMatch('/commit', cmd)?.tier).toBe(SlashMatchTier.ExactName)
    expect(scoreSlashMatch('/com', cmd)?.tier).toBe(SlashMatchTier.Prefix)
    expect(scoreSlashMatch('/mit', cmd)?.tier).toBe(SlashMatchTier.Substring)
    expect(scoreSlashMatch('/cmt', cmd)?.tier).toBe(SlashMatchTier.Subsequence)
  })
})

describe('match positions', () => {
  // The positions are what the composer menu highlights, so they must be the match that ranked
  // the row — and index the name as given, past its leading `/`.
  it('reports the ranked substring in the name as given', () => {
    const m = scoreSlashMatch('/mit', cmd)
    expect(m?.tier).toBe(SlashMatchTier.Substring)
    expect([...(m?.positions ?? [])]).toEqual([4, 5, 6]) // /com[mit]
    expect([...(scoreSlashMatch('mit', { ...cmd, name: 'commit' })?.positions ?? [])]).toEqual([
      3, 4, 5,
    ])
  })

  it('reports a description match against the description', () => {
    const m = scoreSlashMatch('/and', cmd)
    expect(m?.field).toBe('description')
    expect([...(m?.positions ?? [])]).toEqual([6, 7, 8]) // Stage [and] …
  })
})

describe('minWeakLen option', () => {
  it('gates the weak tiers at 2+ chars by DEFAULT (unopted surface)', () => {
    // Single non-prefix char: prefix still works, but substring/subsequence do NOT.
    expect(scoreSlashMatch('/c', cmd)?.tier).toBe(SlashMatchTier.Prefix)
    expect(scoreSlashMatch('/m', cmd)).toBeNull() // 'm' is a substring of "commit" but gated
  })

  it('lets the weak tiers match at a SINGLE char when minWeakLen: 1 (web behaviour)', () => {
    const m = scoreSlashMatch('/m', cmd, { minWeakLen: 1 })
    expect(m?.tier).toBe(SlashMatchTier.Substring) // com[m]it
    expect(m?.field).toBe('name')
  })

  it('a single char that prefixes still ranks as Prefix regardless of minWeakLen', () => {
    expect(scoreSlashMatch('/c', cmd, { minWeakLen: 1 })?.tier).toBe(SlashMatchTier.Prefix)
    expect(scoreSlashMatch('/c', cmd, { minWeakLen: 2 })?.tier).toBe(SlashMatchTier.Prefix)
  })
})

describe('descriptionPrefixTier option', () => {
  it('by DEFAULT a description prefix ranks only as Substring (unopted surface)', () => {
    const m = scoreSlashMatch('/stage', cmd)
    expect(m?.tier).toBe(SlashMatchTier.Substring)
    expect(m?.field).toBe('description')
  })

  it('elevates a description prefix to Prefix (tier 1) when enabled (web behaviour)', () => {
    const m = scoreSlashMatch('/stage', cmd, { descriptionPrefixTier: true })
    expect(m?.tier).toBe(SlashMatchTier.Prefix)
    expect(m?.field).toBe('description')
  })

  it('a description prefix is un-gated by minWeakLen', () => {
    // Single char 's' prefixes the description; still Prefix even at the default gate.
    const m = scoreSlashMatch('/s', cmd, { descriptionPrefixTier: true })
    expect(m?.tier).toBe(SlashMatchTier.Prefix)
    expect(m?.field).toBe('description')
  })

  it('a name prefix still wins over a description prefix', () => {
    // 'c' prefixes the NAME "commit" — name prefix is checked first.
    const m = scoreSlashMatch('/c', cmd, { descriptionPrefixTier: true })
    expect(m?.field).toBe('name')
  })
})
