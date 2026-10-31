import { describe, expect, test } from 'bun:test'

import {
  checkUrlSafety,
  isPrivateAddress,
  isPrivateIPv6,
  PRIVATE_NETWORK_HOSTS,
  PUBLIC_NETWORK_HOSTS,
} from '@localixai/mini-app-sdk/backend'

/**
 * The central research reader consumes the SDK-owned guard and its public regression vectors.
 *
 * Mutation-check: restore the dotted-quad-only `::ffff:(\d+\.\d+\.\d+\.\d+)` isPrivateIPv6
 * and every hex-form / full-form / NAT64 vector below goes RED.
 */
describe('net-safety.ts — SSRF IPv6 v4-mapped / NAT64 (shared vectors)', () => {
  test('every private vector is classified private, and refused by checkUrlSafety', async () => {
    for (const ip of PRIVATE_NETWORK_HOSTS) {
      expect(isPrivateAddress(ip), ip).toBe(true)
      expect(isPrivateIPv6(ip), ip).toBe(true)
      expect(await checkUrlSafety(new URL(`http://[${ip}]/`)), ip).toBeTruthy()
    }
  })

  test('every public vector stays public (allowed)', async () => {
    for (const ip of PUBLIC_NETWORK_HOSTS) {
      expect(isPrivateAddress(ip), ip).toBe(false)
      expect(await checkUrlSafety(new URL(`http://[${ip}]/`)), ip).toBeNull()
    }
  })
})
