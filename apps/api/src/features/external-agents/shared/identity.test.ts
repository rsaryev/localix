import { describe, expect, it } from 'bun:test'
import { linkKeyOf, parseLinkKey, sameKey } from './identity'

describe('link identity', () => {
  it('keeps the SAME native id in two providers apart', () => {
    // The whole reason the key is a pair. If these collapsed, linking a Codex session would show
    // a Claude Code transcript, silently and with no error anywhere.
    const shared = '019fb705-2736-7e51-8f51-bcc0587804c2'
    const a = linkKeyOf({ provider: 'claude-code', nativeSessionId: shared })
    const b = linkKeyOf({ provider: 'codex', nativeSessionId: shared })
    expect(a).not.toBe(b)
    expect(
      sameKey(
        { provider: 'claude-code', nativeSessionId: shared },
        { provider: 'codex', nativeSessionId: shared },
      ),
    ).toBe(false)
  })

  it('round-trips every provider’s real id shape', () => {
    const cases = [
      { provider: 'claude-code', nativeSessionId: '0c61aa4b-2d91-4864-8511-8d812c644a04' },
      { provider: 'codex', nativeSessionId: '019fb705-2736-7e51-8f51-bcc0587804c2' },
      { provider: 'opencode', nativeSessionId: 'ses_2adab60c7ffexaCef1crdavEmA' },
      { provider: 'gemini-cli', nativeSessionId: 'ab07eb04-fbae-432e-ab39-204cd29da87b' },
    ]
    for (const original of cases) {
      expect(parseLinkKey(linkKeyOf(original))).toEqual(original)
    }
  })

  it('an id containing the separator cannot forge another provider’s key', () => {
    // Without encoding, nativeSessionId "codex:evil" under provider "a" would parse back as
    // provider "a", id "codex:evil" — or worse, be mistaken for the codex namespace.
    const forged = linkKeyOf({ provider: 'a', nativeSessionId: 'codex:evil' })
    expect(parseLinkKey(forged)).toEqual({ provider: 'a', nativeSessionId: 'codex:evil' })
    expect(parseLinkKey(forged)?.provider).not.toBe('codex')
  })

  it('rejects malformed keys instead of throwing', () => {
    for (const bad of ['', 'no-separator', ':leading', 'trailing:', '%zz:x']) {
      expect(parseLinkKey(bad)).toBeNull()
    }
  })
})
