/**
 * The FNV-1a hash helpers now live in `@localixai/mini-app-sdk/backend` so mini apps
 * consume them from the SDK instead of deep-importing this host path. This file
 * re-exports them to keep the host's existing internal import path working.
 */
export { fnv1a32, fnv1aHex } from '@localixai/mini-app-sdk/backend'
