/**
 * The RATCHET between the SSRF guard and the preview detector.
 *
 * the SDK's `net-safety.ts` (GUARD) and `tools/preview/served-url-detect.ts` (DETECTOR)
 * each own a private-range list, deliberately — see the detector's module header. The
 * lists are the same data under OPPOSITE stakes: a range the GUARD wrongly calls public
 * is an SSRF hole; a range the DETECTOR wrongly calls public is only a dev server we
 * fail to auto-open. So the guard must over-include forever, and the detector may only
 * ever be widened toward it.
 *
 * This test enforces exactly that one-way relation at RUNTIME (a `satisfies`-style
 * compile-time guard inside a `.test.ts` would be checked by nothing: apps/api's
 * tsconfig excludes test files and `bun test` does not typecheck):
 *
 *   for every address the GUARD calls private → the DETECTOR must NOT call it public.
 *
 * It can go red in exactly two ways, both of which we want to hear about:
 *   1. the detector falls behind the guard (a local range would be silently undetected —
 *      this is the `127.0.0.2` bug that prompted the test);
 *   2. someone NARROWS the guard (an SSRF regression).
 *
 * It can never push the guard to shrink: widening the detector always satisfies it.
 * Nothing here imports one module into the other; the coupling is a test, not a wire.
 */
import { describe, expect, test } from 'bun:test'
import { isPrivateAddress } from '@localixai/mini-app-sdk/backend'
import { classifyHost, isUnspecifiedHost } from './served-url-detect'

/**
 * "Not surfaced as a public host" — the property that actually matters. The bind-all
 * addresses (`0.0.0.0`, `::`) classify as loopback and are rewritten to `localhost`; a
 * literal `*` is rejected upstream as unspecified. Every other guard-private address must
 * classify as loopback / private-ip / custom, never `public-ip` (the only kind the detector
 * treats as "not local, do not open from the banner alone").
 */
const detectorTreatsAsNonPublic = (host: string): boolean =>
  isUnspecifiedHost(host) || classifyHost(host) !== 'public-ip'

describe('detector ⊇ guard: every private range the SSRF guard knows is non-public to the detector', () => {
  test('IPv4: full first-two-octet sweep (the guard only ever branches on a and b)', () => {
    const missed: string[] = []
    let examined = 0
    for (let a = 0; a <= 255; a++) {
      for (let b = 0; b <= 255; b++) {
        const ip = `${a}.${b}.1.1`
        if (!isPrivateAddress(ip)) continue
        examined++
        if (!detectorTreatsAsNonPublic(ip)) missed.push(ip)
      }
    }
    // SCAN LIVENESS. `missed` being empty is the GOAL state, so it can never prove the
    // sweep still sweeps: make `isPrivateAddress` return false for everything and the
    // `continue` skips all 65 536 probes, leaving missed=[] — this test passed at
    // 1 expect / 0 fail against a completely blinded SSRF guard (mutation-verified;
    // only the named-ranges test below caught it). Count what was actually examined.
    // 10.x + 172.16-31.x + 192.168.x + 127.x + 100.64-127.x + 0.x + link-local + … ≫ 500.
    expect(examined).toBeGreaterThan(500)
    expect(missed).toEqual([])
  })

  test('IPv4: the ranges that regressed, named explicitly', () => {
    for (const ip of ['127.0.0.2', '127.255.255.254', '100.64.0.1', '100.127.0.1', '0.1.2.3']) {
      expect(isPrivateAddress(ip)).toBe(true) // guard: private
      expect(classifyHost(ip)).not.toBe('public-ip') // detector: must agree it is local
    }
  })

  test('IPv6: loopback / unique-local / link-local / v4-mapped', () => {
    for (const ip of ['::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:10.0.0.1', '::']) {
      expect(isPrivateAddress(ip)).toBe(true)
      expect(detectorTreatsAsNonPublic(ip)).toBe(true)
    }
  })

  test('IPv6: HEX-form v4-mapped loopback / NAT64 — the previously-undetected gap', () => {
    // These are pure-hex (no dotted quad), so `isIpv6` matches them and the detector
    // must decode the embedded IPv4 exactly as the guard does. Before the shared
    // byte-decode they classified `public-ip` and a dev server advertised in this form
    // never auto-opened. Mutation: restore the prefix-only `isPrivateIpv6` → all RED.
    for (const ip of [
      '::ffff:7f00:1', // hex-form v4-mapped 127.0.0.1 (loopback)
      '::ffff:c0a8:1', // hex-form v4-mapped 192.168.0.1 (private)
      '0:0:0:0:0:ffff:7f00:1', // full-form v4-mapped loopback
      '64:ff9b::7f00:1', // NAT64 127.0.0.1
      '64:ff9b::a00:1', // NAT64 10.0.0.1
    ]) {
      expect(isPrivateAddress(ip)).toBe(true) // guard: private
      expect(classifyHost(ip)).not.toBe('public-ip') // detector: must agree it is local
    }
  })

  test('the relation is one-way: a public address stays public on BOTH sides', () => {
    // Guards the ratchet against the lazy "fix": blurring everything into private would
    // pass the sweep above while destroying the detector's purpose.
    for (const ip of ['93.184.216.34', '8.8.8.8', '100.63.0.1', '172.32.0.1', '2606:4700::1111']) {
      expect(isPrivateAddress(ip)).toBe(false)
      expect(classifyHost(ip)).toBe('public-ip')
    }
  })
})
