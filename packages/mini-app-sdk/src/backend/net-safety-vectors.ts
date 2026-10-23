/**
 * Regression vectors shared by the SDK, host, and native-mini-app tests. These spellings cover
 * IPv4-mapped and NAT64 forms that a dotted-quad-only check misses.
 */
export const PRIVATE_NETWORK_HOSTS = [
  '::ffff:7f00:1',
  '0:0:0:0:0:ffff:7f00:1',
  '::ffff:a00:1',
  '::ffff:c0a8:1',
  '::ffff:a9fe:1',
  '::ffff:ac10:1',
  '64:ff9b::7f00:1',
  '64:ff9b::a00:1',
  '::ffff:127.0.0.1',
  '::1',
  '::',
  'fc00::1',
  'fd12:3456::1',
  'fe80::1',
] as const

export const PUBLIC_NETWORK_HOSTS = [
  '::ffff:8.8.8.8',
  '::ffff:808:808',
  '::ffff:6362:100',
  '2606:4700:4700::1111',
] as const
