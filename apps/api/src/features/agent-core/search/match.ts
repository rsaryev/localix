/**
 * The field scorer lives in `@localixai/plugin-sdk/backend` (over `@localixai/search`) so plugins
 * consume it from the SDK instead of deep-importing this host path. This file re-exports it to keep
 * the host import path working.
 */
export { bestFieldScore } from '@localixai/plugin-sdk/backend'
