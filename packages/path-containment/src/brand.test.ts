import { describe, expect, test } from 'bun:test'

import { resolveWithin, type ContainedPath } from './index'

/**
 * THE BRAND, PROVEN BY THE COMPILER.
 *
 * `ContainedPath` is the difference between a rule that is FORBIDDEN and one that is
 * IMPOSSIBLE. A lint can only say "do not hand-roll this" — it scans for the spellings it
 * knows, and a copy written in a spelling it does not know goes straight through. The brand
 * makes the copy POINTLESS instead: a callee that demands `ContainedPath` cannot be handed
 * the output of a hand-rolled check, because a hand-rolled check returns `string`, and only
 * this module can mint the brand.
 *
 * That claim is a claim about the TYPE CHECKER, so it is tested by the type checker. Each
 * `@ts-expect-error` below is an assertion that the line does NOT compile — and TypeScript
 * reports an UNUSED `@ts-expect-error` as an error in its own right, so if the brand ever
 * stops biting (someone widens the type, or re-declares it as a bare `string` alias), this
 * file goes red in `bun run type-check`. The guard cannot silently rot into a no-op.
 *
 * `bun test` compiles but does not type-check, so THIS FILE'S REAL ASSERTIONS RUN IN
 * `type-check`, not here. The runtime test below only pins the zero-cost half of the deal:
 * the proof is the string itself, so it needs no unwrapping at any call site.
 */

/** A callee that DEMANDS proof. This is the shape every destructive path consumer should have. */
function readsOnlyContained(p: ContainedPath): string {
  return p
}

/** A hand-rolled check — sound-looking, returns a bare `string`. The compiler is unimpressed. */
function handRolled(root: string, target: string): string {
  const abs = `${root}/${target}`
  return abs.startsWith(`${root}/`) ? abs : root
}

describe('ContainedPath — the callee demands proof', () => {
  test('an unchecked string cannot be passed off as contained', () => {
    const untrusted = '/etc/passwd'
    // @ts-expect-error — a plain string is not a ContainedPath. THIS IS THE MECHANISM.
    readsOnlyContained(untrusted)

    // @ts-expect-error — nor is the output of a hand-rolled containment check. A copy of the
    // rule cannot satisfy the callee, so copying the rule buys the author nothing.
    readsOnlyContained(handRolled('/a/root', 'child.ts'))

    // @ts-expect-error — nor can the brand be forged by assertion-free construction.
    const forged: ContainedPath = '/etc/passwd'
    expect(forged as string).toBe('/etc/passwd')
  })

  test('the owner mints it — and the proof IS the string (zero cost at every call site)', () => {
    const proven = resolveWithin('/a/root', 'child.ts')
    expect(proven).not.toBeNull()
    if (!proven) throw new Error('unreachable')

    // No unwrap, no `.value`, no runtime object: it goes straight into anything taking a string.
    expect(readsOnlyContained(proven)).toBe('/a/root/child.ts')
    expect(proven.endsWith('child.ts')).toBe(true)
    const asPlainString: string = proven
    expect(asPlainString).toBe('/a/root/child.ts')
  })

  test('an escaping path yields no proof at all, so there is nothing to pass on', () => {
    expect(resolveWithin('/a/root', '../../etc/passwd')).toBeNull()
  })
})
