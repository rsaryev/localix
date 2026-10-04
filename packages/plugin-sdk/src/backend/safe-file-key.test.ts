import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import { safeFileKey } from './safe-file-key'

/**
 * The behaviour half of the safe-file-key contract. The structural half — "there is exactly
 * ONE copy of this rule" — lives in apps/api's `safe-file-key-contract.test.ts`, and it is the half that
 * can actually observe the defect this primitive was extracted to kill (four copies that AGREE
 * pass every behaviour assertion, right up until one is edited and the others are not).
 *
 * These assertions run the escape attempts through a REAL `path.join`, on Bun, because that is
 * the runtime we ship on: a claim about what `path.join` does with a sanitized segment is only
 * worth what the runtime actually does with it.
 */
describe('safeFileKey', () => {
  const ROOT = '/srv/localix/secrets'
  /** Exactly how every caller uses it: one sanitized SEGMENT, joined under a store root. */
  const fileFor = (key: string) => path.join(ROOT, `${safeFileKey(key)}.json`)

  test('the rule is an allow-list: only [A-Za-z0-9_-] survives', () => {
    expect(safeFileKey('AZaz09_-')).toBe('AZaz09_-')
    expect(safeFileKey('local-user')).toBe('local-user')
    // A UUID passes through untouched — the common case is the identity function.
    expect(safeFileKey('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(
      '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    )
  })

  describe('traversal inputs cannot escape the store directory', () => {
    const escapes: Array<[name: string, key: string]> = [
      ['relative traversal', '../../etc/passwd'],
      ['deep traversal', '../../../../../../etc/cron.d/pwn'],
      ['bare dot-dot', '..'],
      ['single dot', '.'],
      ['absolute posix path', '/etc/passwd'],
      ['absolute windows path', 'C:\\Windows\\System32\\config\\SAM'],
      ['windows separators', '..\\..\\secrets'],
      ['NUL byte', 'user\0/../../etc/passwd'],
      ['NUL truncation attempt', 'user\0.json'],
      ['newline', 'user\n../../root'],
      ['home expansion', '~/.ssh/authorized_keys'],
      ['url-encoded traversal', '%2e%2e%2f%2e%2e%2fetc'],
      ['double-encoded traversal', '..%252f..%252fetc'],
      ['unicode fullwidth solidus', 'a／..／b'],
      ['unicode division slash', 'a∕..∕b'],
      ['unicode overlong-ish separator', 'a⧸..⧸b'],
      ['RTL override', 'user‮/../../etc'],
      ['zero-width joiner', 'a‍/../b'],
      ['dotfile shadowing the master key', '.masterkey'],
      ['empty string', ''],
      ['whitespace only', '   '],
    ]

    for (const [name, key] of escapes) {
      test(name, () => {
        const safe = safeFileKey(key)

        // 1. The sanitized key is a single path segment: no separator of any kind survives.
        expect(safe).not.toContain('/')
        expect(safe).not.toContain('\\')
        expect(safe).not.toContain('\0')
        expect(safe).not.toMatch(/\./)
        expect(safe).toMatch(/^[A-Za-z0-9_-]*$/)

        // 2. And therefore the joined path stays inside the store root — checked through the
        //    real path.join, not by reasoning about it.
        const file = fileFor(key)
        expect(file.startsWith(`${ROOT}${path.sep}`)).toBe(true)
        expect(path.dirname(file)).toBe(ROOT)
        expect(path.relative(ROOT, file).startsWith('..')).toBe(false)
      })
    }

    test('a traversal key cannot reach the AES master key beside the vault', () => {
      // `.masterkey` is the one file in the secrets dir that is not a user's vault. The
      // sanitizer must not let a crafted userId name it (the `.json` suffix is what saves
      // us even if the stem collides, but the stem must not collide either).
      expect(fileFor('.masterkey')).toBe(path.join(ROOT, '_masterkey.json'))
      expect(fileFor('.masterkey')).not.toBe(path.join(ROOT, '.masterkey'))
    })
  })

  test('LOSSY, by construction — the map is not injective (a RULING; see the owner doc)', () => {
    // Pinned deliberately: the documented hazard, not an accident. The rule is allowed to be
    // lossy for exactly ONE reason — `userId` is self-asserted, so there is no authentication
    // boundary for a collision to cross. Anyone who can forge `a/b` can just send `a_b`.
    //
    // That precondition is not trusted to a comment. `safe-file-key-contract.test.ts` reads it
    // out of `app.ts` and FAILS THE BUILD the moment userId stops being self-asserted — see the
    // TRIPWIRE test there, which carries the migration checklist. If you are here because you
    // added authentication, that test is already red and it is telling you what to do.
    //
    // If a caller ever needs a collision-free key, THIS assertion is the one that must change,
    // in the one owner — which is the whole point of there being one.
    expect(safeFileKey('a/b')).toBe(safeFileKey('a_b'))
    expect(safeFileKey('../etc')).toBe(safeFileKey('___etc'))
  })
})
