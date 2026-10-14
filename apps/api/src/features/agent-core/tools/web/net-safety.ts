/**
 * Compatibility seam for existing host imports. The backend SDK owns the implementation so
 * research and native plugins enforce one SSRF/body-budget policy.
 */
export {
  checkUrlSafety,
  isPrivateAddress,
  isPrivateIPv4,
  isPrivateIPv6,
  readBodyCapped,
} from '@localixai/plugin-sdk/backend'
export type { HostResolver, HttpFetch } from '@localixai/plugin-sdk/backend'
